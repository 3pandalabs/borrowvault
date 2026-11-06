import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activeBookingId, canSend, messageBody, pageOf, preview, reportReason } from "../src/chat/rules.js";

// Chat (api/ROUTES.md "Chat"): pure rules + routes through fastify.inject with
// an in-memory fake of chat/store.ts and mocked role lookups (no Postgres).
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
const STRANGER = "44444444-4444-4444-8444-444444444444";
const SOCIETY = "55555555-5555-4555-8555-555555555555";
const LISTING = "66666666-6666-4666-8666-666666666666";
const BOOKING = "77777777-7777-4777-8777-777777777777";
const MISSING = "99999999-9999-4999-8999-999999999999";

type Msg = { id: string; seq: number; conversationId: string; senderId: string; body: string; createdAt: Date };
type Conv = {
  id: string;
  listingId: string;
  societyId: string;
  ownerId: string;
  borrowerId: string;
  createdAt: Date;
  lastMessageAt: Date | null;
  ownerLastReadSeq: number;
  borrowerLastReadSeq: number;
};

const s = vi.hoisted(() => ({
  members: new Set<string>(), // approved members of SOCIETY
  admins: new Set<string>(), // society admins of SOCIETY
  sharesUnit: false,
  listingStatus: "active",
  bookingState: null as null | string,
  convs: [] as Conv[],
  msgs: [] as Msg[],
  reports: [] as { id: string; messageId: string; reporterId: string; conversationId: string; status: string; reason: string; createdAt: Date; reviewedAt: Date | null; reviewNote: string | null; reviewedBy: string | null; societyId: string }[],
  seq: 0,
  n: 0,
  notified: 0,
}));

const uid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++s.n).padStart(12, "0")}`;

vi.mock("../src/lib/authz.js", () => ({
  approvedMembership: vi.fn(async (u: string) => (s.members.has(u) ? { role: s.admins.has(u) ? "society_admin" : "resident" } : null)),
  isSocietyAdmin: vi.fn(async (u: string) => s.admins.has(u)),
  requireSocietyAdmin: vi.fn(async (u: string) => {
    const { DomainError } = await import("../src/lib/errors.js");
    if (s.admins.has(u)) return;
    if (s.members.has(u)) throw new DomainError("FORBIDDEN", "society_admin_required");
    throw new DomainError("NOT_FOUND", "not_found");
  }),
  sharesUnitWithParty: vi.fn(async () => s.sharesUnit),
}));

vi.mock("../src/lib/notify.js", () => ({
  notifySocietyAdmins: vi.fn(async () => {
    s.notified++;
  }),
}));

vi.mock("../src/chat/store.js", () => {
  const listing = () => ({ id: LISTING, societyId: SOCIETY, ownerId: OWNER, title: "Drill", status: s.listingStatus, photoKeys: [] });
  const bookings = () =>
    s.bookingState
      ? [{ id: BOOKING, state: s.bookingState, stateChangedAt: new Date(0), createdAt: new Date(0), startsAt: new Date(0), endsAt: new Date(1), listingId: LISTING, borrowerId: BORROWER }]
      : [];
  const view = (m: Msg) => ({ id: m.id, senderId: m.senderId, body: m.body, createdAt: m.createdAt.toISOString() });
  const party = (id: string) => ({ id, displayName: id.slice(0, 4), towerName: null, flatNo: null, trust: { score: 4, completed: 0, disputesLost: 0 } });
  const unread = (c: Conv, u: string) =>
    s.msgs.filter((m) => m.conversationId === c.id && m.senderId !== u && m.seq > (c.ownerId === u ? c.ownerLastReadSeq : c.borrowerLastReadSeq)).length;
  return {
    messageView: view,
    findListing: async (id: string) => (id === LISTING ? listing() : null),
    coverUrl: async () => null,
    findConversation: async (id: string) => s.convs.find((c) => c.id === id) ?? null,
    findConversationFor: async (l: string, b: string) => s.convs.find((c) => c.listingId === l && c.borrowerId === b) ?? null,
    getOrCreateConversation: async (l: { id: string; societyId: string; ownerId: string }, b: string) => {
      const ex = s.convs.find((c) => c.listingId === l.id && c.borrowerId === b);
      if (ex) return { row: ex, created: false };
      const row: Conv = { id: uid(), listingId: l.id, societyId: l.societyId, ownerId: l.ownerId, borrowerId: b, createdAt: new Date(), lastMessageAt: null, ownerLastReadSeq: 0, borrowerLastReadSeq: 0 };
      s.convs.push(row);
      return { row, created: true };
    },
    findBooking: async (id: string) => (id === BOOKING && s.bookingState ? { id, listingId: LISTING, lenderId: OWNER, borrowerId: BORROWER } : null),
    bookingsBetween: async () => bookings(),
    partyInfos: async (_s: string, ids: string[]) => new Map(ids.map((i) => [i, party(i)])),
    unreadFor: async (cid: string, u: string) => unread(s.convs.find((c) => c.id === cid)!, u),
    listMine: async (u: string) => {
      const rows = s.convs
        .filter((c) => c.borrowerId === u || (c.ownerId === u && c.lastMessageAt))
        .map((c) => ({ c, unread: unread(c, u) }));
      const last = new Map<string, Msg>();
      for (const m of s.msgs) last.set(m.conversationId, m);
      return { rows, lastByConv: last, listingsById: new Map([[LISTING, listing()]]), bookings: bookings() };
    },
    seqOf: async (cid: string, mid: string) => s.msgs.find((m) => m.id === mid && m.conversationId === cid)?.seq ?? null,
    fetchMessages: async (cid: string, q: { afterSeq?: number; beforeSeq?: number; limit: number }) => {
      const all = s.msgs.filter((m) => m.conversationId === cid);
      if (q.afterSeq !== undefined) return all.filter((m) => m.seq > q.afterSeq!).slice(0, q.limit + 1);
      return all
        .filter((m) => q.beforeSeq === undefined || m.seq < q.beforeSeq)
        .reverse()
        .slice(0, q.limit + 1);
    },
    insertMessage: async (cid: string, sender: string, side: string, body: string) => {
      const m: Msg = { id: uid(), seq: ++s.seq, conversationId: cid, senderId: sender, body, createdAt: new Date() };
      s.msgs.push(m);
      const c = s.convs.find((x) => x.id === cid)!;
      c.lastMessageAt = m.createdAt;
      if (side === "owner") c.ownerLastReadSeq = m.seq;
      else c.borrowerLastReadSeq = m.seq;
      return m;
    },
    markRead: async (cid: string, side: string, seq: number | null) => {
      const c = s.convs.find((x) => x.id === cid)!;
      const target = seq ?? Math.max(0, ...s.msgs.filter((m) => m.conversationId === cid).map((m) => m.seq));
      if (side === "owner") c.ownerLastReadSeq = Math.max(c.ownerLastReadSeq, target);
      else c.borrowerLastReadSeq = Math.max(c.borrowerLastReadSeq, target);
    },
    unreadCounts: async (u: string) => {
      const out: Record<string, number> = {};
      for (const c of s.convs) if ((c.ownerId === u || c.borrowerId === u) && unread(c, u) > 0) out[c.id] = unread(c, u);
      return out;
    },
    findMessage: async (id: string) => {
      const m = s.msgs.find((x) => x.id === id);
      return m ? { m, c: s.convs.find((c) => c.id === m.conversationId)! } : null;
    },
    insertReport: async (m: Msg, c: Conv, reporterId: string, reason: string) => {
      if (s.reports.some((r) => r.messageId === m.id && r.reporterId === reporterId)) return null;
      const r = { id: uid(), messageId: m.id, reporterId, conversationId: c.id, societyId: c.societyId, status: "open", reason, createdAt: new Date(), reviewedAt: null, reviewNote: null, reviewedBy: null };
      s.reports.push(r);
      return r;
    },
    listReports: async (_sid: string, status: string) =>
      s.reports.filter((r) => r.status === status).map((r) => ({ r, c: s.convs.find((c) => c.id === r.conversationId)! })),
    findReport: async (id: string) => {
      const r = s.reports.find((x) => x.id === id);
      return r ? { r, c: s.convs.find((c) => c.id === r.conversationId)! } : null;
    },
    reviewReport: async (id: string, by: string, note: string | null) => {
      const r = s.reports.find((x) => x.id === id)!;
      if (r.status === "open") Object.assign(r, { status: "reviewed", reviewedBy: by, reviewedAt: new Date(), reviewNote: note });
      return r;
    },
    reportContext: async (m: Msg) => s.msgs.filter((x) => x.conversationId === m.conversationId && Math.abs(x.seq - m.seq) <= 5),
    findMessagesByIds: async (ids: string[]) => s.msgs.filter((m) => ids.includes(m.id)),
    userNames: async (ids: string[]) => new Map(ids.map((i) => [i, "name"])),
  };
});

let app: FastifyInstance;
const tok: Record<string, { authorization: string }> = {};

beforeAll(async () => {
  const { authPlugin } = await import("../src/auth/plugin.js");
  const { signAccessToken } = await import("../src/auth/jwt.js");
  const { DomainError } = await import("../src/lib/errors.js");
  const { chatRoutes } = await import("../src/routes/chat.js");
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
  await app.ready();
  for (const u of [OWNER, BORROWER, ADMIN, STRANGER]) tok[u] = { authorization: `Bearer ${signAccessToken({ sub: u })}` };
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  s.members = new Set([OWNER, BORROWER, ADMIN]);
  s.admins = new Set([ADMIN]);
  s.sharesUnit = false;
  s.listingStatus = "active";
  s.bookingState = null;
  s.convs = [];
  s.msgs = [];
  s.reports = [];
  s.notified = 0;
});

const req = (who: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, headers: tok[who], payload });

async function open() {
  const r = await req(BORROWER, "POST", "/conversations", { listingId: LISTING });
  return r.json().id as string;
}
async function send(who: string, id: string, body: string) {
  return req(who, "POST", `/conversations/${id}/messages`, { body });
}

describe("rules (pure)", () => {
  it("message body is trimmed and bounded in code points", () => {
    expect(messageBody.parse("  hi  ")).toBe("hi");
    expect(messageBody.safeParse("   ").success).toBe(false);
    expect(messageBody.safeParse("x".repeat(2000)).success).toBe(true);
    expect(messageBody.safeParse("x".repeat(2001)).success).toBe(false);
    expect(messageBody.safeParse("😀".repeat(2000)).success).toBe(true); // 4000 UTF-16 units, 2000 chars
  });
  it("report reason 5-500", () => {
    expect(reportReason.safeParse("rude").success).toBe(false);
    expect(reportReason.safeParse("abusive language").success).toBe(true);
  });
  it("preview truncates to 140", () => {
    expect(preview("short")).toBe("short");
    expect([...preview("y".repeat(300))].length).toBe(140);
  });
  it("canSend", () => {
    const now = Date.now();
    const old = new Date(now - 30 * 86_400_000);
    const base = { role: "borrower" as const, listingStatus: "active", senderApprovedMember: true, bookings: [], now };
    expect(canSend(base)).toBe(true);
    expect(canSend({ ...base, role: "admin" })).toBe(false);
    expect(canSend({ ...base, listingStatus: "archived" })).toBe(false);
    expect(canSend({ ...base, senderApprovedMember: false })).toBe(false);
    const live = { id: "b", state: "ACTIVE" as const, stateChangedAt: old, createdAt: old };
    expect(canSend({ ...base, listingStatus: "archived", senderApprovedMember: false, bookings: [live] })).toBe(true);
    const done = { ...live, state: "COMPLETED" as const };
    expect(canSend({ ...base, listingStatus: "archived", bookings: [done] })).toBe(false);
    expect(canSend({ ...base, listingStatus: "archived", bookings: [{ ...done, stateChangedAt: new Date(now - 86_400_000) }] })).toBe(true);
  });
  it("activeBookingId picks the newest live booking", () => {
    const d = (t: number) => new Date(t);
    expect(
      activeBookingId([
        { id: "a", state: "COMPLETED", stateChangedAt: d(3), createdAt: d(3) },
        { id: "b", state: "REQUESTED", stateChangedAt: d(1), createdAt: d(1) },
        { id: "c", state: "ACTIVE", stateChangedAt: d(2), createdAt: d(2) },
      ]),
    ).toBe("c");
  });
  it("pageOf returns oldest-first and flags more", () => {
    const rows = [5, 4, 3].map((seq) => ({ seq }));
    expect(pageOf(rows, 2, "older")).toEqual({ rows: [{ seq: 4 }, { seq: 5 }], hasMore: true });
    expect(pageOf([{ seq: 1 }], 2, "newer")).toEqual({ rows: [{ seq: 1 }], hasMore: false });
  });
});

describe("opening a conversation", () => {
  it("get-or-create is idempotent (201 then 200, same id)", async () => {
    const a = await req(BORROWER, "POST", "/conversations", { listingId: LISTING });
    const b = await req(BORROWER, "POST", "/conversations", { listingId: LISTING });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().id).toBe(a.json().id);
    expect(a.json()).toMatchObject({ myRole: "borrower", canSend: true, unreadCount: 0, activeBookingId: null, listing: { id: LISTING } });
  });
  it("non-member → 404", async () => {
    const r = await req(STRANGER, "POST", "/conversations", { listingId: LISTING });
    expect(r.statusCode).toBe(404);
  });
  it("unknown listing → 404", async () => {
    expect((await req(BORROWER, "POST", "/conversations", { listingId: MISSING })).statusCode).toBe(404);
  });
  it("owner can't open a chat on their own listing (403)", async () => {
    const r = await req(OWNER, "POST", "/conversations", { listingId: LISTING });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ error: "cannot_message_own_listing", code: "FORBIDDEN" });
  });
  it("archived listing: no new conversation (404), existing one still returned", async () => {
    const id = await open();
    s.listingStatus = "archived";
    s.members.add(STRANGER);
    expect((await req(STRANGER, "POST", "/conversations", { listingId: LISTING })).statusCode).toBe(404);
    const again = await req(BORROWER, "POST", "/conversations", { listingId: LISTING });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id, canSend: false });
  });
  it("booking party can get-or-create via the booking; others 404", async () => {
    s.bookingState = "ACCEPTED";
    const r = await req(OWNER, "POST", `/bookings/${BOOKING}/conversation`);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ myRole: "owner", activeBookingId: BOOKING, canSend: true });
    expect((await req(BORROWER, "POST", `/bookings/${BOOKING}/conversation`)).statusCode).toBe(200);
    expect((await req(ADMIN, "POST", `/bookings/${BOOKING}/conversation`)).statusCode).toBe(404);
  });
});

describe("messages", () => {
  it("participants send and read; non-participants get 404", async () => {
    const id = await open();
    const m = await send(BORROWER, id, "  Is the drill free on Saturday?  ");
    expect(m.statusCode).toBe(201);
    expect(m.json()).toMatchObject({ senderId: BORROWER, body: "Is the drill free on Saturday?" });
    expect((await send(OWNER, id, "Yes")).statusCode).toBe(201);
    expect((await send(STRANGER, id, "hi")).statusCode).toBe(404);
    expect((await req(STRANGER, "GET", `/conversations/${id}/messages`)).statusCode).toBe(404);
    expect((await req(STRANGER, "GET", `/conversations/${id}`)).statusCode).toBe(404);
    expect((await req(ADMIN, "GET", `/conversations/${id}`)).statusCode).toBe(404); // no dispute
    const list = await req(OWNER, "GET", `/conversations/${id}/messages`);
    expect(list.json().messages.map((x: Msg) => x.body)).toEqual(["Is the drill free on Saturday?", "Yes"]);
  });
  it("empty / oversize body → 400", async () => {
    const id = await open();
    const e = await send(BORROWER, id, "   ");
    expect(e.statusCode).toBe(400);
    expect(e.json()).toEqual({ error: "message_empty", code: "VALIDATION" });
    const big = await send(BORROWER, id, "x".repeat(2001));
    expect(big.json()).toEqual({ error: "message_too_long", code: "VALIDATION" });
    expect((await req(BORROWER, "POST", `/conversations/${id}/messages`, {})).statusCode).toBe(400);
  });
  it("closed conversation → 409 conversation_closed", async () => {
    const id = await open();
    s.listingStatus = "archived";
    const r = await send(BORROWER, id, "hello?");
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ error: "conversation_closed", code: "CONFLICT" });
    s.bookingState = "ACTIVE"; // a live booking reopens it
    expect((await send(BORROWER, id, "hello?")).statusCode).toBe(201);
  });
  it("cursor paging: latest page, before, after", async () => {
    const id = await open();
    const ids: string[] = [];
    for (let i = 1; i <= 7; i++) ids.push((await send(i % 2 ? BORROWER : OWNER, id, `m${i}`)).json().id);
    const page = (await req(BORROWER, "GET", `/conversations/${id}/messages?limit=3`)).json();
    expect(page.messages.map((m: Msg) => m.body)).toEqual(["m5", "m6", "m7"]);
    expect(page.hasMore).toBe(true);
    const older = (await req(BORROWER, "GET", `/conversations/${id}/messages?limit=3&before=${ids[4]}`)).json();
    expect(older.messages.map((m: Msg) => m.body)).toEqual(["m2", "m3", "m4"]);
    expect(older.hasMore).toBe(true);
    const oldest = (await req(BORROWER, "GET", `/conversations/${id}/messages?limit=3&before=${ids[1]}`)).json();
    expect(oldest).toMatchObject({ hasMore: false });
    expect(oldest.messages.map((m: Msg) => m.body)).toEqual(["m1"]);
    const newer = (await req(BORROWER, "GET", `/conversations/${id}/messages?limit=2&after=${ids[3]}`)).json();
    expect(newer.messages.map((m: Msg) => m.body)).toEqual(["m5", "m6"]);
    expect(newer.hasMore).toBe(true);
    const none = (await req(BORROWER, "GET", `/conversations/${id}/messages?after=${ids[6]}`)).json();
    expect(none).toEqual({ messages: [], hasMore: false });
  });
  it("bad cursors and limits → 400", async () => {
    const id = await open();
    const m = (await send(BORROWER, id, "x")).json().id;
    expect((await req(BORROWER, "GET", `/conversations/${id}/messages?after=${MISSING}`)).statusCode).toBe(400);
    expect((await req(BORROWER, "GET", `/conversations/${id}/messages?after=${m}&before=${m}`)).statusCode).toBe(400);
    expect((await req(BORROWER, "GET", `/conversations/${id}/messages?limit=101`)).statusCode).toBe(400);
  });
  it("immutability: no edit/delete routes exist", async () => {
    const id = await open();
    const m = (await send(BORROWER, id, "evidence")).json().id;
    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      expect((await req(BORROWER, method, `/messages/${m}`, { body: "changed" })).statusCode).toBe(404);
      expect((await req(BORROWER, method, `/conversations/${id}/messages/${m}`, { body: "changed" })).statusCode).toBe(404);
      expect((await req(BORROWER, method, `/conversations/${id}`, {})).statusCode).toBe(404);
    }
  });
});

describe("unread", () => {
  it("counts the other side's messages until marked read", async () => {
    const id = await open();
    await send(BORROWER, id, "q1");
    const q2 = (await send(BORROWER, id, "q2")).json().id;
    await send(BORROWER, id, "q3");
    expect((await req(OWNER, "GET", "/conversations/unread")).json()).toEqual({ total: 3, byConversation: { [id]: 3 } });
    expect((await req(BORROWER, "GET", "/conversations/unread")).json()).toEqual({ total: 0, byConversation: {} });
    expect((await req(OWNER, "POST", `/conversations/${id}/read`, { upToMessageId: q2 })).statusCode).toBe(204);
    expect((await req(OWNER, "GET", "/conversations/unread")).json().total).toBe(1);
    const list = (await req(OWNER, "GET", "/conversations")).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, unreadCount: 1, myRole: "owner", other: { id: BORROWER }, lastMessage: { body: "q3" } });
    expect((await req(OWNER, "POST", `/conversations/${id}/read`)).statusCode).toBe(204);
    expect((await req(OWNER, "GET", "/conversations/unread")).json().total).toBe(0);
    expect((await req(OWNER, "POST", `/conversations/${id}/read`, { upToMessageId: MISSING })).statusCode).toBe(400);
  });
  it("owner doesn't see empty conversations; borrower does", async () => {
    await open();
    expect((await req(OWNER, "GET", "/conversations")).json()).toEqual([]);
    expect((await req(BORROWER, "GET", "/conversations")).json()).toHaveLength(1);
  });
});

describe("admin read access", () => {
  it("only while DISPUTED/RESOLVED, read-only, arbiter rule applies", async () => {
    const id = await open();
    await send(BORROWER, id, "it was already scratched");
    expect((await req(ADMIN, "GET", `/conversations/${id}/messages`)).statusCode).toBe(404);
    s.bookingState = "ACTIVE";
    expect((await req(ADMIN, "GET", `/conversations/${id}`)).statusCode).toBe(404);
    s.bookingState = "DISPUTED";
    const c = await req(ADMIN, "GET", `/conversations/${id}`);
    expect(c.statusCode).toBe(200);
    expect(c.json()).toMatchObject({ myRole: "admin", canSend: false, unreadCount: 0 });
    expect((await req(ADMIN, "GET", `/conversations/${id}/messages`)).json().messages).toHaveLength(1);
    expect((await send(ADMIN, id, "ruling soon")).json()).toEqual({ error: "participants_only", code: "FORBIDDEN" });
    expect((await req(ADMIN, "POST", `/conversations/${id}/read`)).statusCode).toBe(403);
    s.bookingState = "RESOLVED";
    expect((await req(ADMIN, "GET", `/conversations/${id}`)).statusCode).toBe(200);
    s.sharesUnit = true; // lives in a party's unit
    expect((await req(ADMIN, "GET", `/conversations/${id}`)).statusCode).toBe(404);
    s.sharesUnit = false;
    expect((await req(STRANGER, "GET", `/conversations/${id}`)).statusCode).toBe(404); // not an admin
  });
});

describe("reports", () => {
  it("participant reports the other's message once; admins list and review", async () => {
    const id = await open();
    const mine = (await send(BORROWER, id, "hello")).json().id;
    const theirs = (await send(OWNER, id, "something rude")).json().id;
    const own = await req(BORROWER, "POST", `/messages/${mine}/report`, { reason: "testing myself" });
    expect(own.json()).toEqual({ error: "cannot_report_own_message", code: "FORBIDDEN" });
    expect((await req(BORROWER, "POST", `/messages/${theirs}/report`, { reason: "bad" })).statusCode).toBe(400);
    expect((await req(STRANGER, "POST", `/messages/${theirs}/report`, { reason: "abusive language" })).statusCode).toBe(404);
    const r = await req(BORROWER, "POST", `/messages/${theirs}/report`, { reason: "abusive language" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ messageId: theirs, status: "open" });
    expect(s.notified).toBe(1);
    const dup = await req(BORROWER, "POST", `/messages/${theirs}/report`, { reason: "abusive language" });
    expect(dup.json()).toEqual({ error: "already_reported", code: "CONFLICT" });

    expect((await req(BORROWER, "GET", `/admin/societies/${SOCIETY}/message-reports`)).statusCode).toBe(403);
    expect((await req(STRANGER, "GET", `/admin/societies/${SOCIETY}/message-reports`)).statusCode).toBe(404);
    const list = (await req(ADMIN, "GET", `/admin/societies/${SOCIETY}/message-reports`)).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      status: "open",
      reason: "abusive language",
      reporter: { id: BORROWER },
      message: { id: theirs, body: "something rude" },
      conversation: { id, owner: { id: OWNER }, borrower: { id: BORROWER } },
    });
    expect(list[0].context.map((m: Msg) => m.body)).toEqual(["hello", "something rude"]);

    s.sharesUnit = true; // conflicted admin: hidden + 404
    expect((await req(ADMIN, "GET", `/admin/societies/${SOCIETY}/message-reports`)).json()).toEqual([]);
    expect((await req(ADMIN, "POST", `/admin/message-reports/${list[0].id}/review`, {})).statusCode).toBe(404);
    s.sharesUnit = false;

    const rev = await req(ADMIN, "POST", `/admin/message-reports/${list[0].id}/review`, { note: "warned the owner" });
    expect(rev.statusCode).toBe(200);
    expect(rev.json()).toMatchObject({ status: "reviewed", reviewNote: "warned the owner" });
    const again = await req(ADMIN, "POST", `/admin/message-reports/${list[0].id}/review`, { note: "other" });
    expect(again.json().reviewNote).toBe("warned the owner");
    expect((await req(ADMIN, "GET", `/admin/societies/${SOCIETY}/message-reports`)).json()).toEqual([]);
    expect((await req(ADMIN, "GET", `/admin/societies/${SOCIETY}/message-reports?status=reviewed`)).json()).toHaveLength(1);
  });
});

describe("rate limit", () => {
  it("sends are limited to 30/min per user", async () => {
    const id = await open();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await send(OWNER, id, `spam ${i}`)).statusCode;
    expect(last).toBe(429);
  });
});
