import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Chat push (api/ROUTES.md "Push notifications" + /me/push-tokens): routes via
// fastify.inject, in-memory fakes of lib/pushTokens.ts and chat/store.ts, and
// a mocked global fetch standing in for the Expo push service.
vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://nobody:nothing@127.0.0.1:1/none",
    JWT_SECRET: "test-secret-test-secret-test-secret",
    R2_ACCOUNT_ID: "test",
    R2_ACCESS_KEY_ID: "test",
    R2_SECRET_ACCESS_KEY: "test",
    R2_ENDPOINT: "https://r2.invalid",
  });
});

const OWNER = "11111111-1111-4111-8111-111111111111";
const BORROWER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const SOCIETY = "55555555-5555-4555-8555-555555555555";
const LISTING = "66666666-6666-4666-8666-666666666666";
const CONV = "88888888-8888-4888-8888-888888888888";
const T_OWNER = "ExponentPushToken[owner-phone]";
const T_OWNER2 = "ExpoPushToken[owner-tablet]";
const T_BORROWER = "ExponentPushToken[borrower-phone]";

type Tok = { userId: string; token: string; platform: string; lastSeenAt: number };

const s = vi.hoisted(() => ({
  tokens: [] as Tok[],
  pushOff: new Set<string>(),
  conv: { ownerLastReadSeq: 0, borrowerLastReadSeq: 0 },
  seq: 0,
  n: 0,
  targetsThrow: false,
}));

vi.mock("../src/lib/pushTokens.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/pushTokens.js")>("../src/lib/pushTokens.js");
  return {
    EXPO_PUSH_TOKEN_RE: actual.EXPO_PUSH_TOKEN_RE,
    upsertTokenQuery: actual.upsertTokenQuery,
    // Mirrors the SQL: upsert on token, reassigning the owner.
    upsertToken: vi.fn(async (userId: string, token: string, platform: string) => {
      const ex = s.tokens.find((t) => t.token === token);
      if (ex) Object.assign(ex, { userId, platform, lastSeenAt: Date.now() });
      else s.tokens.push({ userId, token, platform, lastSeenAt: Date.now() });
    }),
    deleteToken: vi.fn(async (userId: string, token: string) => {
      s.tokens = s.tokens.filter((t) => !(t.userId === userId && t.token === token));
    }),
    deleteTokensOf: vi.fn(async (userId: string) => {
      s.tokens = s.tokens.filter((t) => t.userId !== userId);
    }),
    deleteTokens: vi.fn(async (tokens: string[]) => {
      s.tokens = s.tokens.filter((t) => !tokens.includes(t.token));
    }),
    chatPushTargets: vi.fn(async (userId: string) => {
      if (s.targetsThrow) throw new Error("db down");
      return s.pushOff.has(userId) ? [] : s.tokens.filter((t) => t.userId === userId).map((t) => t.token);
    }),
  };
});

vi.mock("../src/lib/authz.js", () => ({
  approvedMembership: vi.fn(async () => ({ role: "resident" })),
  isSocietyAdmin: vi.fn(async (u: string) => u === ADMIN),
  requireSocietyAdmin: vi.fn(async () => {}),
  sharesUnitWithParty: vi.fn(async () => false),
}));

vi.mock("../src/lib/notify.js", () => ({ notifySocietyAdmins: vi.fn(async () => {}) }));

vi.mock("../src/lib/blocks.js", () => ({
  blockedEitherWay: vi.fn(async () => false),
  hasBlocked: vi.fn(async () => false),
}));

vi.mock("../src/chat/store.js", () => {
  const conv = () => ({
    id: CONV,
    listingId: LISTING,
    societyId: SOCIETY,
    ownerId: OWNER,
    borrowerId: BORROWER,
    createdAt: new Date(0),
    lastMessageAt: null,
    ownerLastReadSeq: s.conv.ownerLastReadSeq,
    borrowerLastReadSeq: s.conv.borrowerLastReadSeq,
  });
  return {
    messageView: (m: { id: string; senderId: string; body: string; createdAt: Date }) => ({
      id: m.id,
      senderId: m.senderId,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    }),
    findConversation: async (id: string) => (id === CONV ? conv() : null),
    bookingsBetween: async () => [],
    findListing: async () => ({ id: LISTING, societyId: SOCIETY, ownerId: OWNER, title: "Bosch drill", status: "active", photoKeys: [] }),
    insertMessage: async (cid: string, senderId: string, side: string, body: string) => {
      const seq = ++s.seq;
      if (side === "owner") s.conv.ownerLastReadSeq = seq;
      else s.conv.borrowerLastReadSeq = seq;
      return { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++s.n).padStart(12, "0")}`, seq, conversationId: cid, senderId, body, createdAt: new Date() };
    },
    userNames: async (ids: string[]) => new Map(ids.map((i) => [i, i === OWNER ? "Asha" : "Ravi"])),
  };
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

let app: FastifyInstance;
const tok: Record<string, { authorization: string }> = {};

beforeAll(async () => {
  const { authPlugin } = await import("../src/auth/plugin.js");
  const { signAccessToken } = await import("../src/auth/jwt.js");
  const { DomainError } = await import("../src/lib/errors.js");
  const { chatRoutes } = await import("../src/routes/chat.js");
  const { pushRoutes } = await import("../src/routes/push.js");
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((err: FastifyError & { publicCode?: string }, _req, reply) => {
    if (err instanceof DomainError) return reply.code(err.status).send({ error: err.message, code: err.code });
    if (err.validation) return reply.code(400).send({ error: err.message, code: "VALIDATION" });
    if (err.publicCode) return reply.code(err.statusCode ?? 429).send({ error: err.publicCode });
    return reply.code(err.statusCode ?? 500).send({ error: String(err.message) });
  });
  await app.register(authPlugin);
  await app.register(chatRoutes);
  await app.register(pushRoutes);
  await app.ready();
  for (const u of [OWNER, BORROWER, ADMIN]) tok[u] = { authorization: `Bearer ${signAccessToken({ sub: u })}` };
});

afterAll(async () => {
  await app?.close();
  vi.unstubAllGlobals();
});

const okTickets = (n: number) => ({ ok: true, status: 200, json: async () => ({ data: Array.from({ length: n }, (_, i) => ({ status: "ok", id: `t${i}` })) }) });

beforeEach(async () => {
  const { resetPushThrottle } = await import("../src/chat/push.js");
  resetPushThrottle();
  s.tokens = [];
  s.pushOff = new Set();
  s.conv = { ownerLastReadSeq: 0, borrowerLastReadSeq: 0 };
  s.targetsThrow = false;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init: { body: string }) => okTickets(JSON.parse(init.body).length));
  vi.useRealTimers();
});

const req = (who: string, method: "POST" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, headers: tok[who], payload });
const send = (who: string, body: string) => req(who, "POST", `/conversations/${CONV}/messages`, { body });
const register = (who: string, token: string, platform = "android") => req(who, "POST", "/me/push-tokens", { token, platform });
/** Lets the fire-and-forget push run. */
const settle = () => new Promise((r) => setTimeout(r, 25));
const pushedBodies = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body));

describe("POST/DELETE /me/push-tokens", () => {
  it("validates the Expo token format and platform", async () => {
    for (const bad of ["", "abc", "ExponentPushToken[]", "ExponentPushToken[a b]", "FooPushToken[x]", "ExponentPushToken[x]trailing"]) {
      expect((await register(OWNER, bad)).statusCode).toBe(400);
    }
    expect((await register(OWNER, T_OWNER, "windows")).statusCode).toBe(400);
    expect((await register(OWNER, T_OWNER)).statusCode).toBe(204);
    expect((await register(OWNER, T_OWNER2, "ios")).statusCode).toBe(204);
    expect(s.tokens.map((t) => t.token)).toEqual([T_OWNER, T_OWNER2]);
  });
  it("needs auth", async () => {
    const r = await app.inject({ method: "POST", url: "/me/push-tokens", payload: { token: T_OWNER, platform: "ios" } });
    expect(r.statusCode).toBe(401);
  });
  it("re-registering is an upsert; a token moving to another user is reassigned", async () => {
    await register(OWNER, T_OWNER);
    await register(OWNER, T_OWNER);
    expect(s.tokens).toHaveLength(1);
    await register(BORROWER, T_OWNER, "ios");
    expect(s.tokens).toEqual([expect.objectContaining({ userId: BORROWER, token: T_OWNER, platform: "ios" })]);
  });
  it("upsert SQL conflicts on token and reassigns user_id", async () => {
    const { upsertTokenQuery } = await import("../src/lib/pushTokens.js");
    const q = upsertTokenQuery(OWNER, T_OWNER, "ios").toSQL();
    expect(q.sql).toMatch(/insert into "push_tokens"/);
    expect(q.sql).toMatch(/on conflict \("token"\) do update set "user_id" = \$\d+, "platform" = \$\d+, "last_seen_at" = now\(\)/);
    expect(q.params).toContain(OWNER);
  });
  it("DELETE removes only the caller's own token, always 204", async () => {
    await register(OWNER, T_OWNER);
    await register(BORROWER, T_BORROWER);
    expect((await req(OWNER, "DELETE", "/me/push-tokens", { token: T_BORROWER })).statusCode).toBe(204);
    expect(s.tokens).toHaveLength(2);
    expect((await req(OWNER, "DELETE", "/me/push-tokens", { token: T_OWNER })).statusCode).toBe(204);
    expect(s.tokens.map((t) => t.token)).toEqual([T_BORROWER]);
    expect((await req(OWNER, "DELETE", "/me/push-tokens", { token: T_OWNER })).statusCode).toBe(204);
    expect((await req(OWNER, "DELETE", "/me/push-tokens", {})).statusCode).toBe(400);
  });
});

describe("chat push", () => {
  it("notifies only the other participant's devices with the right payload", async () => {
    await register(OWNER, T_OWNER);
    await register(OWNER, T_OWNER2, "ios");
    await register(BORROWER, T_BORROWER);
    expect((await send(BORROWER, "Is the drill free on Saturday?")).statusCode).toBe(201);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBeUndefined(); // no EXPO_ACCESS_TOKEN
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const msgs = JSON.parse(init.body);
    expect(msgs.map((m: { to: string }) => m.to)).toEqual([T_OWNER, T_OWNER2]); // never the sender's token
    expect(msgs[0]).toEqual({
      to: T_OWNER,
      title: "Ravi",
      body: "Bosch drill: Is the drill free on Saturday?",
      data: { type: "chat", conversationId: CONV },
      sound: "default",
      priority: "high",
      channelId: "chat",
    });
  });
  it("truncates the preview to 100 characters", async () => {
    await register(OWNER, T_OWNER);
    await send(BORROWER, "x".repeat(300));
    await settle();
    const body: string = pushedBodies()[0][0].body;
    const preview = body.slice("Bosch drill: ".length);
    expect([...preview]).toHaveLength(100);
    expect(preview.endsWith("…")).toBe(true);
  });
  it("throttles to one push per 60 s per (conversation, recipient) unless the recipient read the last pushed one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
    await register(OWNER, T_OWNER);
    await register(BORROWER, T_BORROWER);
    await send(BORROWER, "one");
    await settle();
    await send(BORROWER, "two"); // within 60 s, owner hasn't read "one"
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await send(OWNER, "reply"); // other direction has its own slot (and marks "two" read for the owner)
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(pushedBodies()[1][0].to).toBe(T_BORROWER);
    await send(BORROWER, "three"); // owner read past "one" (sending moved their marker) → pushes at once
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await send(BORROWER, "four"); // throttled again
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.setSystemTime(new Date("2026-11-06T10:01:01Z")); // window over
    await send(BORROWER, "five");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("DeviceNotRegistered ticket deletes that token only", async () => {
    await register(OWNER, T_OWNER);
    await register(OWNER, T_OWNER2, "ios");
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } },
          { status: "ok", id: "t1" },
        ],
      }),
    }));
    await send(BORROWER, "hi");
    await settle();
    expect(s.tokens.map((t) => t.token)).toEqual([T_OWNER2]);
  });
  it("disabled preference → no push", async () => {
    await register(OWNER, T_OWNER);
    s.pushOff.add(OWNER);
    expect((await send(BORROWER, "hi")).statusCode).toBe(201);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("recipient without tokens → no push", async () => {
    await register(BORROWER, T_BORROWER);
    await send(BORROWER, "hi");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("send still answers 201 when the push call throws or the push service is down", async () => {
    await register(OWNER, T_OWNER);
    fetchMock.mockRejectedValue(new Error("network down"));
    expect((await send(BORROWER, "a")).statusCode).toBe(201);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    s.targetsThrow = true;
    expect((await send(BORROWER, "b")).statusCode).toBe(201);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("batches more than 100 tokens", async () => {
    for (let i = 0; i < 150; i++) await (await import("../src/lib/pushTokens.js")).upsertToken(OWNER, `ExponentPushToken[d${i}]`, "android");
    await send(BORROWER, "hi");
    await settle();
    expect(pushedBodies().map((b) => b.length)).toEqual([100, 50]);
  });
});
