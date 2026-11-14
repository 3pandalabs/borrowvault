import { fileURLToPath } from "node:url";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Join request notice (api/ROUTES.md "Join request notice") end to end against
// a REAL Postgres: the recipient query is the interesting part. Skipped unless
// TEST_DATABASE_URL points at a throwaway database (it DROPS the public
// schema); see playPolicy.db.test.ts for the docker one-liner.

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: process.env.TEST_DATABASE_URL || "postgres://nobody:nothing@127.0.0.1:1/none",
    JWT_SECRET: "test-secret-test-secret-test-secret",
    R2_ACCOUNT_ID: "test",
    R2_ACCESS_KEY_ID: "test",
    R2_SECRET_ACCESS_KEY: "test",
    R2_ENDPOINT: "https://r2.invalid",
    TEMPORAL_ADDRESS: "127.0.0.1:1",
    WEB_ORIGIN: "https://borrowvault.example",
  });
});

const sent = vi.hoisted(() => ({ mails: [] as { to: string; subject: string; text: string; html: string }[], pushes: [] as Record<string, unknown>[] }));
vi.mock("../src/lib/mailer.js", async (orig) => {
  const real = await orig<typeof import("../src/lib/mailer.js")>();
  return {
    ...real,
    sendMail: vi.fn(async (msgs: typeof sent.mails) => {
      sent.mails.push(...msgs);
      return { delivered: msgs.length, failed: 0, skipped: 0 };
    }),
  };
});
vi.mock("../src/lib/push.js", () => ({
  sendPush: vi.fn(async (msgs: Record<string, unknown>[]) => {
    sent.pushes.push(...msgs);
  }),
}));

const RUN = Boolean(process.env.TEST_DATABASE_URL);

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { signAccessToken } from "../src/auth/jwt.js";
import { authPlugin } from "../src/auth/plugin.js";
import { db, pool } from "../src/db/index.js";
import { memberships, pushTokens, societies, towers, units, users } from "../src/db/schema.js";
import { DomainError } from "../src/lib/errors.js";
import { societyRoutes } from "../src/routes/societies.js";

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

describe.skipIf(!RUN)("join request notice (Postgres)", () => {
  let app: FastifyInstance;
  let society: string;
  let tower: string;
  let other: string;
  let n = 0;

  async function user(name: string, opts: { deleted?: boolean } = {}) {
    const [u] = await db
      .insert(users)
      .values({ email: `${name}-${++n}@example.com`, passwordHash: "x", displayName: name, phone: "+919876543210", deletedAt: opts.deleted ? new Date() : null, emailVerifiedAt: new Date() })
      .returning();
    return u;
  }

  async function member(
    u: { id: string },
    societyId: string,
    role: "resident" | "society_admin",
    status: "approved" | "pending" | "revoked" = "approved",
  ) {
    const [t] = await db.select().from(towers).where(eq(towers.societyId, societyId)).limit(1);
    const [unit] = await db.insert(units).values({ towerId: t.id, flatNo: `U${++n}` }).returning();
    await db.insert(memberships).values({ userId: u.id, societyId, unitId: unit.id, role, status, occupancy: "owner" });
  }

  const join = (u: { id: string }, flatNo = "101") =>
    app.inject({
      method: "POST",
      url: `/societies/${society}/join`,
      headers: { authorization: `Bearer ${signAccessToken({ sub: u.id })}` },
      payload: { towerId: tower, flatNo, occupancy: "tenant" },
    });

  // The notice is fire-and-forget: wait until it has gone out.
  const settled = () => vi.waitFor(() => expect(sent.mails.length).toBeGreaterThan(0), { timeout: 3000 });

  beforeAll(async () => {
    await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await migrate(drizzle(pool), { migrationsFolder: drizzleDir });
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(authPlugin);
    app.setErrorHandler((err: FastifyError, _req, reply) => {
      if (err instanceof DomainError) return reply.code(err.status).send({ error: err.message, code: err.code });
      if (err.validation) return reply.code(400).send({ error: err.message, code: "VALIDATION" });
      return reply.code(err.statusCode ?? 500).send({ error: String(err.message) });
    });
    await app.register(societyRoutes);
    await app.ready();
    const [s] = await db.insert(societies).values({ name: "Lake View", city: "Pune", centerLat: 18.5, centerLng: 73.8, status: "live" }).returning();
    const [s2] = await db.insert(societies).values({ name: "Elsewhere", city: "Pune", centerLat: 18.6, centerLng: 73.9, status: "live" }).returning();
    society = s.id;
    other = s2.id;
    const [t] = await db.insert(towers).values({ societyId: society, name: "A" }).returning();
    tower = t.id;
    await db.insert(towers).values({ societyId: other, name: "Z" });
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  beforeEach(() => {
    sent.mails.length = 0;
    sent.pushes.length = 0;
  });

  it("emails and pushes every approved admin of the society, and nobody else", async () => {
    const admin1 = await user("Admin One");
    const admin2 = await user("Admin Two");
    const resident = await user("Resident");
    const pendingAdmin = await user("Pending Admin");
    const revokedAdmin = await user("Revoked Admin");
    const deletedAdmin = await user("Deleted Admin", { deleted: true });
    const otherAdmin = await user("Other Admin");
    const platform = await user("Platform");
    await db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, platform.id));
    await member(admin1, society, "society_admin");
    await member(admin2, society, "society_admin");
    await member(resident, society, "resident");
    await member(pendingAdmin, society, "society_admin", "pending");
    await member(revokedAdmin, society, "society_admin", "revoked");
    await member(deletedAdmin, society, "society_admin");
    await member(otherAdmin, other, "society_admin");
    await db.insert(pushTokens).values([
      { userId: admin1.id, token: "ExponentPushToken[admin1]", platform: "android" },
      { userId: resident.id, token: "ExponentPushToken[resident]", platform: "android" },
      { userId: otherAdmin.id, token: "ExponentPushToken[other]", platform: "ios" },
    ]);
    // Admin push isn't gated by the chat switch.
    await db.update(users).set({ chatPushEnabled: false }).where(eq(users.id, admin1.id));

    const requester = await user("Priya Shah");
    await db.insert(pushTokens).values({ userId: requester.id, token: "ExponentPushToken[requester]", platform: "android" });
    const res = await join(requester, "101b");
    expect(res.statusCode).toBe(201);
    const membershipId = res.json().id as string;
    await settled();

    expect(sent.mails.map((m) => m.to).sort()).toEqual([admin1.email, admin2.email].sort());
    const mail = sent.mails[0];
    expect(mail.subject).toBe("Priya Shah asked to join Lake View");
    expect(mail.text).toContain("Priya Shah (tower A, flat 101B) asked to join Lake View");
    expect(mail.text).toContain(`https://borrowvault.example/admin/${society}`);
    expect(mail.html).toContain(`href="https://borrowvault.example/admin/${society}"`);
    expect(mail.html).toContain("Review join request");
    // Name + flat only: no contact details or proof.
    expect(mail.text).not.toContain(requester.email);
    expect(mail.text).not.toContain("+919876543210");
    expect(mail.text).not.toContain("tenant");

    await vi.waitFor(() => expect(sent.pushes.length).toBe(1));
    expect(sent.pushes[0]).toEqual({
      to: "ExponentPushToken[admin1]",
      title: "New join request",
      body: "Priya Shah (A-101B) asked to join Lake View. Tap to review.",
      data: { type: "join_request", societyId: society, membershipId },
      sound: "default",
      channelId: "default",
    });
  });

  it("a re-submit while pending is refused and notifies nobody again", async () => {
    const requester = await user("Again");
    expect((await join(requester, "202")).statusCode).toBe(201);
    await settled();
    sent.mails.length = 0;
    sent.pushes.length = 0;
    expect((await join(requester, "202")).statusCode).toBe(409);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent.mails).toEqual([]);
    expect(sent.pushes).toEqual([]);
  });

  it("a revoked admin who re-applies isn't notified about their own request", async () => {
    // Re-applying turns the membership into a pending resident one, and the
    // requester is excluded by id as well.
    const ex = await user("Ex Admin");
    await member(ex, society, "society_admin", "revoked");
    expect((await join(ex, "303")).statusCode).toBe(201);
    await settled();
    expect(sent.mails.map((m) => m.to)).not.toContain(ex.email);
  });
});
