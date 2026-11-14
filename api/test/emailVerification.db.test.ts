import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Email verification (api/ROUTES.md "Email verification") end to end against a
// REAL Postgres. Skipped unless TEST_DATABASE_URL is set. It does NOT touch
// that database's schema: it creates (and recreates) its own database
// `<db>_emailverify` next to it, so it can run in parallel with
// playPolicy.db.test.ts, which drops the public schema of TEST_DATABASE_URL.

const urls = vi.hoisted(() => {
  const base = process.env.TEST_DATABASE_URL;
  let own = "postgres://nobody:nothing@127.0.0.1:1/none";
  if (base) {
    const u = new URL(base);
    u.pathname = `${u.pathname.replace(/^\//, "") || "postgres"}_emailverify`;
    own = u.toString();
  }
  Object.assign(process.env, {
    DATABASE_URL: own,
    JWT_SECRET: "test-secret-test-secret-test-secret",
    R2_ACCOUNT_ID: "test",
    R2_ACCESS_KEY_ID: "test",
    R2_SECRET_ACCESS_KEY: "test",
    R2_ENDPOINT: "https://r2.invalid",
    TEMPORAL_ADDRESS: "127.0.0.1:1",
    WEB_ORIGIN: "https://web.test",
  });
  return { base, own };
});

const mails = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; url: string }[] }));
vi.mock("../src/lib/mailer.js", () => ({
  sendMail: vi.fn(async () => ({ delivered: 1, failed: 0, skipped: 0 })),
  simpleMail: vi.fn(() => ({})),
  actionMail: vi.fn((to: string, subject: string, _t: string, _b: string, url: string) => {
    mails.sent.push({ to, subject, url });
    return {};
  }),
}));

const RUN = Boolean(urls.base);

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { authPlugin } from "../src/auth/plugin.js";
import { db, pool } from "../src/db/index.js";
import { emailVerificationTokens, societies, towers, users } from "../src/db/schema.js";
import { hashVerifyToken } from "../src/lib/emailVerification.js";
import { DomainError } from "../src/lib/errors.js";
import { adminRequestRoutes } from "../src/routes/adminRequests.js";
import { authRoutes } from "../src/routes/auth.js";
import { societyRoutes } from "../src/routes/societies.js";

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));
const PASSWORD = "correct-horse-battery";

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(authPlugin);
  app.setErrorHandler((err: FastifyError & { publicCode?: string }, _req, reply) => {
    if (err instanceof DomainError) return reply.code(err.status).send({ error: err.message, code: err.code });
    if (err.validation) return reply.code(400).send({ error: err.message, code: "VALIDATION" });
    if (err.publicCode) return reply.code(err.statusCode ?? 429).send({ error: err.publicCode });
    return reply.code(err.statusCode ?? 500).send({ error: String(err.message) });
  });
  for (const r of [authRoutes, societyRoutes, adminRequestRoutes]) await app.register(r);
  return app;
}

const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;

describe.skipIf(!RUN)("email verification (Postgres)", () => {
  let app: FastifyInstance;
  let society: string;
  let tower: string;
  let n = 0;

  type Who = { id: string; token: string; email: string };
  const auth = (w: Who) => ({ authorization: `Bearer ${w.token}` });

  async function signup(name: string): Promise<Who> {
    const email = `${name}-${++n}@example.com`;
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: { "cf-connecting-ip": `10.1.0.${n}` },
      payload: { email, password: PASSWORD, displayName: name, phone: "+919876543210" },
    });
    expect(res.statusCode).toBe(201);
    const b = res.json();
    return { id: b.user.id, token: b.accessToken, email };
  }
  const lastMailTo = (email: string) => [...mails.sent].reverse().find((m) => m.to === email);
  const verify = (token: string) => app.inject({ method: "POST", url: "/auth/verify-email", headers: { "cf-connecting-ip": "10.9.9.9" }, payload: { token } });
  const join = (w: Who) =>
    app.inject({ method: "POST", url: `/societies/${society}/join`, headers: auth(w), payload: { towerId: tower, flatNo: `F${++n}`, occupancy: "owner" } });
  const me = async (w: Who) => (await app.inject({ method: "GET", url: "/me", headers: auth(w) })).json();

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: urls.base });
    await admin.connect();
    const name = new URL(urls.own).pathname.slice(1);
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.query(`create database "${name}"`);
    await admin.end();
    await migrate(drizzle(pool), { migrationsFolder: drizzleDir });
    app = await buildApp();
    const [s] = await db.insert(societies).values({ name: "Verify Heights", city: "Pune", centerLat: 18.5, centerLng: 73.8, status: "live" }).returning();
    society = s.id;
    const [t] = await db.insert(towers).values({ societyId: society, name: "A" }).returning();
    tower = t.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("signup starts unverified and mails a hashed, single-use 24 h link", async () => {
    const u = await signup("new");
    expect((await me(u)).user.emailVerified).toBe(false);
    const mail = lastMailTo(u.email);
    expect(mail?.subject).toMatch(/confirm/i);
    expect(mail!.url.startsWith("https://web.test/verify-email?token=")).toBe(true);
    const raw = tokenOf(mail!.url);
    const [row] = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, u.id));
    expect(row.tokenHash).toBe(hashVerifyToken(raw));
    expect(row.tokenHash).not.toContain(raw);
    expect(row.email).toBe(u.email);
    const ttl = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(Math.abs(ttl - 24 * 3600_000)).toBeLessThan(60_000);
  });

  it("an unverified user can't join a society or file an admin request (403 email_unverified)", async () => {
    const u = await signup("blocked");
    const res = await join(u);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "email_unverified", code: "FORBIDDEN" });
    const ar = await app.inject({
      method: "POST",
      url: "/admin-requests",
      headers: { ...auth(u), "cf-connecting-ip": "10.2.0.1" },
      payload: { kind: "join_admin", societyId: society, committeeRole: "Treasurer", docs: { idProofKey: `admin-docs/${u.id}/00000000-0000-4000-8000-000000000003.pdf` } },
    });
    expect(ar.statusCode).toBe(403);
    expect(ar.json()).toEqual({ error: "email_unverified", code: "FORBIDDEN" });
  });

  it("verify works, is idempotent on a second click, and then joining is allowed", async () => {
    const u = await signup("verifies");
    const raw = tokenOf(lastMailTo(u.email)!.url);
    const first = await verify(raw);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ emailVerified: true });
    const [row] = await db.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.id, u.id));
    expect(row.v).not.toBeNull();
    const again = await verify(raw);
    expect(again.statusCode).toBe(200);
    const [row2] = await db.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.id, u.id));
    expect(row2.v?.getTime()).toBe(row.v?.getTime()); // the replay changed nothing
    expect((await me(u)).user.emailVerified).toBe(true);
    expect((await join(u)).statusCode).toBe(201);
  });

  it("rejects an unknown token and an expired one", async () => {
    expect((await verify("not-a-real-token")).statusCode).toBe(400);
    const u = await signup("expired");
    const raw = tokenOf(lastMailTo(u.email)!.url);
    await db.update(emailVerificationTokens).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(emailVerificationTokens.userId, u.id));
    const res = await verify(raw);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_or_expired_token" });
    expect((await me(u)).user.emailVerified).toBe(false);
  });

  it("a link bound to an old address doesn't verify the account", async () => {
    const u = await signup("moved");
    const raw = tokenOf(lastMailTo(u.email)!.url);
    await db.update(users).set({ email: `moved-elsewhere-${n}@example.com` }).where(eq(users.id, u.id));
    expect((await verify(raw)).statusCode).toBe(400);
    expect((await me(u)).user.emailVerified).toBe(false);
  });

  it("resend replaces the old link, is limited to 3 / hour, and 409s once verified", async () => {
    const u = await signup("resend");
    const oldRaw = tokenOf(lastMailTo(u.email)!.url);
    const resend = () => app.inject({ method: "POST", url: "/auth/verify-email/resend", headers: auth(u) });
    expect((await resend()).statusCode).toBe(204);
    const newRaw = tokenOf(lastMailTo(u.email)!.url);
    expect(newRaw).not.toBe(oldRaw);
    expect((await verify(oldRaw)).statusCode).toBe(400);
    expect((await resend()).statusCode).toBe(204);
    expect((await resend()).statusCode).toBe(204);
    expect((await resend()).statusCode).toBe(429);

    const v = await signup("resend-verified");
    expect((await verify(tokenOf(lastMailTo(v.email)!.url))).statusCode).toBe(200);
    const res = await app.inject({ method: "POST", url: "/auth/verify-email/resend", headers: auth(v) });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "email_already_verified", code: "CONFLICT" });
  });

  it("migration 0010 backfills existing users once and is idempotent", async () => {
    const stmts = readFileSync(`${drizzleDir}/0010_email_verification.sql`, "utf8").split("--> statement-breakpoint");
    const run = async () => {
      for (const s of stmts) if (s.trim()) await pool.query(s);
    };
    // Simulate the pre-feature database: no column yet, so everyone is backfilled.
    await pool.query(`alter table users drop column email_verified_at`);
    await run();
    const [{ unverified }] = (await pool.query(`select count(*)::int as unverified from users where email_verified_at is null`)).rows;
    expect(unverified).toBe(0);
    // A user who signs up afterwards stays unverified across re-runs.
    const later = await signup("after-migration");
    await run();
    await run();
    expect((await me(later)).user.emailVerified).toBe(false);
  });
});
