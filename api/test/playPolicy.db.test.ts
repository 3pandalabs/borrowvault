import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Google Play policy fixes (api/ROUTES.md "Account deletion", "Users: blocking
// and reporting", "Admin takedown", browse membership filter) end to end
// against a REAL Postgres, because the interesting parts are SQL: the
// deletion transaction, the id-proof CHECK v2, partial unique indexes and the
// browse predicates. Skipped unless TEST_DATABASE_URL points at a throwaway
// database (it DROPS the public schema), e.g.
//   docker run -d --rm --name bv-test -e POSTGRES_USER=bv -e POSTGRES_PASSWORD=bv -e POSTGRES_DB=bv -p 5499:5432 postgres:17-alpine
//   TEST_DATABASE_URL=postgres://bv:bv@127.0.0.1:5499/bv npm test

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: process.env.TEST_DATABASE_URL || "postgres://nobody:nothing@127.0.0.1:1/none",
    JWT_SECRET: "test-secret-test-secret-test-secret",
    R2_ACCOUNT_ID: "test",
    R2_ACCESS_KEY_ID: "test",
    R2_SECRET_ACCESS_KEY: "test",
    R2_ENDPOINT: "https://r2.invalid",
    TEMPORAL_ADDRESS: "127.0.0.1:1",
  });
});

// Mail and R2 deletes are side effects we don't want; record the purge instead.
const purged = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("../src/lib/mailer.js", () => ({
  sendMail: vi.fn(async () => {}),
  simpleMail: vi.fn(() => ({})),
  actionMail: vi.fn(() => ({})),
}));
vi.mock("../src/plugins/r2.js", async (orig) => {
  const real = await orig<typeof import("../src/plugins/r2.js")>();
  return {
    ...real,
    deleteObjectQuietly: vi.fn(async (k: string) => {
      purged.keys.push(k);
    }),
  };
});

const RUN = Boolean(process.env.TEST_DATABASE_URL);

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { authPlugin } from "../src/auth/plugin.js";
import { db, pool } from "../src/db/index.js";
import {
  adminRequests,
  bookingPayments,
  bookings,
  conversations,
  listingReports,
  listings,
  memberships,
  messages,
  passwordResetTokens,
  pushTokens,
  sessions,
  societies,
  towers,
  units,
  userBlocks,
  users,
} from "../src/db/schema.js";
import { DomainError } from "../src/lib/errors.js";
import { authRoutes } from "../src/routes/auth.js";
import { bookingRoutes } from "../src/routes/bookings.js";
import { chatRoutes } from "../src/routes/chat.js";
import { listingRoutes } from "../src/routes/listings.js";
import { moderationRoutes } from "../src/routes/moderation.js";
import { societyRoutes } from "../src/routes/societies.js";
import { userRoutes } from "../src/routes/users.js";
import { memberCountSql } from "../src/lib/societyTier.js";

const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(authPlugin);
  app.setErrorHandler((err: FastifyError & { publicCode?: string }, _req, reply) => {
    if (err instanceof DomainError) return reply.code(err.status).send({ error: err.message, code: err.code });
    if (err.validation) return reply.code(400).send({ error: err.message, code: "VALIDATION" });
    if (err.publicCode) return reply.code(err.statusCode ?? 429).send({ error: err.publicCode });
    if (err.code === "23505") return reply.code(409).send({ error: "conflict", code: "CONFLICT" });
    return reply.code(err.statusCode ?? 500).send({ error: String(err.message) });
  });
  for (const r of [authRoutes, societyRoutes, listingRoutes, bookingRoutes, chatRoutes, userRoutes, moderationRoutes]) await app.register(r);
  return app;
}

type Who = { id: string; token: string; refresh: string; email: string };
const PASSWORD = "correct-horse-battery";
const PHOTO = (u: string) => `listings/${u}/00000000-0000-4000-8000-000000000001.jpg`;
const PROOF = (u: string) => `proofs/${u}/00000000-0000-4000-8000-000000000002.jpg`;
const IDDOC = (u: string) => `admin-docs/${u}/00000000-0000-4000-8000-000000000003.pdf`;

describe.skipIf(!RUN)("play policy fixes (Postgres)", () => {
  let app: FastifyInstance;
  let society: string;
  let other: string; // a second society
  let unitN = 0;
  let n = 0;

  const auth = (w: Who) => ({ authorization: `Bearer ${w.token}` });

  async function signup(name: string, email = `${name}-${++n}@example.com`): Promise<Who> {
    // A fresh client IP per signup: the route allows 10 / hour per IP.
    const res = await app.inject({ method: "POST", url: "/auth/signup", headers: { "cf-connecting-ip": `10.0.0.${n}` }, payload: { email, password: PASSWORD, displayName: name, phone: "+919876543210" } });
    expect(res.statusCode).toBe(201);
    const b = res.json();
    return { id: b.user.id, token: b.accessToken, refresh: b.refreshToken, email };
  }

  async function member(u: Who, societyId = society, opts: { role?: "resident" | "society_admin"; status?: "approved" | "revoked" | "pending" } = {}) {
    const [t] = await db.select().from(towers).where(eq(towers.societyId, societyId)).limit(1);
    const [unit] = await db.insert(units).values({ towerId: t.id, flatNo: `F${++unitN}` }).returning();
    await db.insert(memberships).values({
      userId: u.id,
      societyId,
      unitId: unit.id,
      role: opts.role ?? "resident",
      status: opts.status ?? "approved",
      occupancy: "owner",
      proofKey: PROOF(u.id),
    });
  }

  async function listing(owner: Who, title: string, societyId = society) {
    const [l] = await db
      .insert(listings)
      .values({ societyId, ownerId: owner.id, kind: "item", category: "power_tools", title, dailyPaise: 10000, depositPaise: 0, requiredPhotoSlots: ["front"], photoKeys: [PHOTO(owner.id)] })
      .returning();
    return l;
  }

  async function booking(l: { id: string; ownerId: string; societyId: string }, borrower: Who, state: (typeof bookings.$inferSelect)["state"], dayOffset: number) {
    const start = new Date(Date.now() + dayOffset * 86_400_000);
    const [b] = await db
      .insert(bookings)
      .values({
        societyId: l.societyId,
        listingId: l.id,
        lenderId: l.ownerId,
        borrowerId: borrower.id,
        state,
        pricing: "daily",
        startsAt: start,
        endsAt: new Date(start.getTime() + 86_400_000),
        feePaise: 10000,
        depositPaise: 0,
        checklistSnapshot: [],
        photoSlotsSnapshot: [],
      })
      .returning();
    return b;
  }

  const browseTitles = async (w: Who) => {
    const res = await app.inject({ method: "GET", url: "/listings", headers: auth(w) });
    expect(res.statusCode).toBe(200);
    return (res.json() as { title: string }[]).map((l) => l.title);
  };

  beforeAll(async () => {
    await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await migrate(drizzle(pool), { migrationsFolder: drizzleDir });
    app = await buildApp();
    const [s] = await db.insert(societies).values({ name: "Test Heights", city: "Pune", centerLat: 18.5, centerLng: 73.8, status: "live" }).returning();
    const [s2] = await db.insert(societies).values({ name: "Elsewhere", city: "Pune", centerLat: 18.6, centerLng: 73.9, status: "live" }).returning();
    society = s.id;
    other = s2.id;
    await db.insert(towers).values([{ societyId: society, name: "A" }, { societyId: other, name: "Z" }]);
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("memberCount counts approved memberships of THAT society (BV-2 regression)", async () => {
    const [s3] = await db.insert(societies).values({ name: "Count Court", city: "Pune", centerLat: 18.7, centerLng: 73.7, status: "live" }).returning();
    await db.insert(towers).values({ societyId: s3.id, name: "C" });
    await member(await signup("cnt-a"), s3.id);
    await member(await signup("cnt-b"), s3.id, { role: "society_admin" });
    await member(await signup("cnt-c"), s3.id, { status: "pending" });
    const rows = await db.select({ id: societies.id, c: memberCountSql }).from(societies);
    expect(rows.find((r) => r.id === s3.id)?.c).toBe(2);
  });

  it("migration 0008 is idempotent (every statement re-runs cleanly)", async () => {
    const stmts = readFileSync(`${drizzleDir}/0008_play_policy.sql`, "utf8").split("--> statement-breakpoint");
    for (let pass = 0; pass < 2; pass++) for (const s of stmts) if (s.trim()) await pool.query(s);
  });

  it("browse and detail hide listings whose owner is no longer an approved member", async () => {
    const viewer = await signup("viewer");
    const live = await signup("live");
    const gone = await signup("gone");
    await member(viewer);
    await member(live);
    await member(gone, society, { status: "revoked" });
    await listing(live, "Live drill");
    const hidden = await listing(gone, "Orphan ladder");

    const titles = await browseTitles(viewer);
    expect(titles).toContain("Live drill");
    expect(titles).not.toContain("Orphan ladder");
    expect((await app.inject({ method: "GET", url: `/listings/${hidden.id}`, headers: auth(viewer) })).statusCode).toBe(404);
    // The owner still sees their own.
    const mine = await app.inject({ method: "GET", url: "/listings?ownerId=me", headers: auth(gone) });
    expect((mine.json() as { title: string }[]).map((l) => l.title)).toContain("Orphan ladder");
  });

  describe("blocking", () => {
    let a: Who, b: Who, stranger: Who;
    let aListing: typeof listings.$inferSelect, bListing: typeof listings.$inferSelect;
    let convId: string;

    beforeAll(async () => {
      a = await signup("alice");
      b = await signup("bob");
      stranger = await signup("stranger");
      await member(a);
      await member(b);
      await member(stranger, other);
      aListing = await listing(a, "Alice tent");
      bListing = await listing(b, "Bob camera");
      // A conversation exists before the block.
      const c = await app.inject({ method: "POST", url: "/conversations", headers: auth(b), payload: { listingId: aListing.id } });
      expect(c.statusCode).toBe(201);
      convId = c.json().id;
      const m = await app.inject({ method: "POST", url: `/conversations/${convId}/messages`, headers: auth(b), payload: { body: "Is it free?" } });
      expect(m.statusCode).toBe(201);
    });

    it("only related users can be blocked; never yourself", async () => {
      expect((await app.inject({ method: "POST", url: `/users/${stranger.id}/block`, headers: auth(a) })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `/users/${a.id}/block`, headers: auth(a) })).json().error).toBe("cannot_block_self");
    });

    it("block is idempotent and listed in /me/blocks", async () => {
      const first = await app.inject({ method: "POST", url: `/users/${a.id}/block`, headers: auth(b) });
      expect(first.statusCode).toBe(201);
      expect(first.json().user).toEqual({ id: a.id, displayName: "alice" });
      expect((await app.inject({ method: "POST", url: `/users/${a.id}/block`, headers: auth(b) })).statusCode).toBe(200);
      const list = await app.inject({ method: "GET", url: "/me/blocks", headers: auth(b) });
      expect(list.json().map((x: { user: { id: string } }) => x.user.id)).toEqual([a.id]);
      // Who blocked you is never shown.
      expect((await app.inject({ method: "GET", url: "/me/blocks", headers: auth(a) })).json()).toEqual([]);
    });

    it("both sides: canSend false, sends 403 blocked, blockedByMe only for the blocker", async () => {
      const asB = (await app.inject({ method: "GET", url: `/conversations/${convId}`, headers: auth(b) })).json();
      const asA = (await app.inject({ method: "GET", url: `/conversations/${convId}`, headers: auth(a) })).json();
      expect([asB.canSend, asA.canSend]).toEqual([false, false]);
      expect([asB.blockedByMe, asA.blockedByMe]).toEqual([true, false]);
      for (const w of [a, b]) {
        const r = await app.inject({ method: "POST", url: `/conversations/${convId}/messages`, headers: auth(w), payload: { body: "hello?" } });
        expect(r.statusCode).toBe(403);
        expect(r.json().error).toBe("blocked");
      }
      // Reading still works.
      expect((await app.inject({ method: "GET", url: `/conversations/${convId}/messages`, headers: auth(a) })).statusCode).toBe(200);
    });

    it("no new conversation and no new booking either way", async () => {
      const conv = await app.inject({ method: "POST", url: "/conversations", headers: auth(a), payload: { listingId: bListing.id } });
      expect([conv.statusCode, conv.json().error]).toEqual([403, "blocked"]);
      const start = new Date(Date.now() + 3 * 86_400_000);
      const book = await app.inject({
        method: "POST",
        url: "/bookings",
        headers: auth(a),
        payload: { listingId: bListing.id, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 86_400_000).toISOString(), pricing: "daily" },
      });
      expect(book.statusCode).toBe(403);
      expect(book.json().error).toBe("blocked");
    });

    it("browse and detail hide each other's listings", async () => {
      expect(await browseTitles(a)).not.toContain("Bob camera");
      expect(await browseTitles(b)).not.toContain("Alice tent");
      expect((await app.inject({ method: "GET", url: `/listings/${aListing.id}`, headers: auth(b) })).statusCode).toBe(404);
    });

    it("unblock restores everything", async () => {
      expect((await app.inject({ method: "DELETE", url: `/users/${a.id}/block`, headers: auth(b) })).statusCode).toBe(204);
      expect((await app.inject({ method: "DELETE", url: `/users/${a.id}/block`, headers: auth(b) })).statusCode).toBe(204);
      expect((await app.inject({ method: "GET", url: `/conversations/${convId}`, headers: auth(a) })).json().canSend).toBe(true);
      expect(await browseTitles(b)).toContain("Alice tent");
    });
  });

  describe("reports and takedown", () => {
    let owner: Who, reporter: Who, admin: Who, resident: Who, stranger: Who;
    let l: typeof listings.$inferSelect;

    beforeAll(async () => {
      owner = await signup("owner");
      reporter = await signup("reporter");
      admin = await signup("admin");
      resident = await signup("resident");
      stranger = await signup("outsider");
      await member(owner);
      await member(reporter);
      await member(admin, society, { role: "society_admin" });
      await member(resident);
      await member(stranger, other);
      l = await listing(owner, "Sketchy speaker");
    });

    it("user report: 201 once, 409 while open, 404 for unrelated, admins see it", async () => {
      const body = { reason: "harassment", details: "  rude in chat  " };
      const r = await app.inject({ method: "POST", url: `/users/${owner.id}/report`, headers: auth(reporter), payload: body });
      expect(r.statusCode).toBe(201);
      expect(r.json().status).toBe("open");
      expect((await app.inject({ method: "POST", url: `/users/${owner.id}/report`, headers: auth(reporter), payload: body })).json().error).toBe("already_reported");
      expect((await app.inject({ method: "POST", url: `/users/${stranger.id}/report`, headers: auth(reporter), payload: body })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `/users/${owner.id}/report`, headers: auth(reporter), payload: { reason: "nope" } })).statusCode).toBe(400);

      expect((await app.inject({ method: "GET", url: `/admin/societies/${society}/user-reports`, headers: auth(resident) })).statusCode).toBe(403);
      const list = await app.inject({ method: "GET", url: `/admin/societies/${society}/user-reports`, headers: auth(admin) });
      expect(list.statusCode).toBe(200);
      const [rep] = list.json();
      expect(rep).toMatchObject({ reason: "harassment", details: "rude in chat", reported: { id: owner.id }, reporter: { id: reporter.id } });
      // The reported user, as admin of nothing, can't see it; arbiter rule hides it from a party who is an admin too.
      const done = await app.inject({ method: "POST", url: `/admin/user-reports/${rep.id}/review`, headers: auth(admin), payload: { decision: "dismissed", note: "talked to both" } });
      expect(done.json()).toMatchObject({ status: "dismissed", reviewNote: "talked to both" });
      // Closed now, so a fresh report is allowed.
      expect((await app.inject({ method: "POST", url: `/users/${owner.id}/report`, headers: auth(reporter), payload: body })).statusCode).toBe(201);
    });

    it("listing report, admin removal, owner can't re-activate, browse hides it", async () => {
      const body = { reason: "prohibited_item", details: "looks stolen" };
      expect((await app.inject({ method: "POST", url: `/listings/${l.id}/report`, headers: auth(owner), payload: body })).json().error).toBe("cannot_report_own_listing");
      expect((await app.inject({ method: "POST", url: `/listings/${l.id}/report`, headers: auth(stranger), payload: body })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `/listings/${l.id}/report`, headers: auth(reporter), payload: body })).statusCode).toBe(201);
      expect((await app.inject({ method: "POST", url: `/listings/${l.id}/report`, headers: auth(reporter), payload: body })).statusCode).toBe(409);

      const list = await app.inject({ method: "GET", url: `/admin/societies/${society}/listing-reports`, headers: auth(admin) });
      expect(list.json()[0]).toMatchObject({ reason: "prohibited_item", listing: { id: l.id, owner: { id: owner.id } } });

      expect((await app.inject({ method: "POST", url: `/admin/listings/${l.id}/remove`, headers: auth(resident), payload: { note: "no thanks" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: `/admin/listings/${l.id}/remove`, headers: auth(stranger), payload: { note: "no thanks" } })).statusCode).toBe(404);
      const removed = await app.inject({ method: "POST", url: `/admin/listings/${l.id}/remove`, headers: auth(admin), payload: { note: "Weapons are not allowed." } });
      expect(removed.statusCode).toBe(200);
      expect(removed.json()).toMatchObject({ status: "removed", removal: { note: "Weapons are not allowed." } });
      // Idempotent.
      expect((await app.inject({ method: "POST", url: `/admin/listings/${l.id}/remove`, headers: auth(admin), payload: { note: "again again" } })).json().removal.note).toBe("Weapons are not allowed.");

      const [rep] = await db.select().from(listingReports).where(eq(listingReports.listingId, l.id));
      expect(rep.status).toBe("actioned");

      for (const patch of [{ status: "active" }, { title: "Totally fine speaker" }]) {
        const p = await app.inject({ method: "PATCH", url: `/listings/${l.id}`, headers: auth(owner), payload: patch });
        expect(p.statusCode).toBe(409);
        expect(p.json().error).toBe("listing_removed");
      }
      const own = await app.inject({ method: "GET", url: `/listings/${l.id}`, headers: auth(owner) });
      expect(own.json()).toMatchObject({ status: "removed", removal: { note: "Weapons are not allowed." } });
      expect((await app.inject({ method: "GET", url: `/listings/${l.id}`, headers: auth(reporter) })).statusCode).toBe(404);
      expect(await browseTitles(reporter)).not.toContain("Sketchy speaker");
      expect((await app.inject({ method: "POST", url: "/conversations", headers: auth(reporter), payload: { listingId: l.id } })).statusCode).toBe(404);
    });

    it("dismissing a listing report", async () => {
      const l2 = await listing(owner, "Fine kettle");
      await app.inject({ method: "POST", url: `/listings/${l2.id}/report`, headers: auth(reporter), payload: { reason: "misleading" } });
      const [rep] = (await app.inject({ method: "GET", url: `/admin/societies/${society}/listing-reports`, headers: auth(admin) })).json();
      const d = await app.inject({ method: "POST", url: `/admin/listing-reports/${rep.id}/dismiss`, headers: auth(admin), payload: { note: "It is fine" } });
      expect(d.json()).toMatchObject({ status: "dismissed", listing: { status: "active" } });
      const closed = await app.inject({ method: "GET", url: `/admin/societies/${society}/listing-reports?status=closed`, headers: auth(admin) });
      expect(closed.json().map((r: { status: string }) => r.status).sort()).toEqual(["actioned", "dismissed"]);
    });
  });

  describe("account deletion", () => {
    it("refuses while bookings, disputes, awards or refunds are open", async () => {
      const lender = await signup("lender");
      const borrower = await signup("borrower");
      await member(lender);
      await member(borrower);
      const l = await listing(lender, "Busy drill");
      const live = await booking(l, borrower, "ACTIVE", 1);
      const disputed = await booking(l, borrower, "DISPUTED", 5);
      const resolved = await booking(l, borrower, "RESOLVED", 9);
      await db.insert(bookingPayments).values({ bookingId: resolved.id, depositMode: "declared", feePaise: 10000, depositPaise: 0, awardPaise: 5000, awardStatus: "debt_recorded", awardPayerId: borrower.id, awardPayeeId: lender.id });
      const cancelled = await booking(l, borrower, "CANCELLED", 13);
      await db.insert(bookingPayments).values({ bookingId: cancelled.id, depositMode: "declared", feePaise: 10000, depositPaise: 0, refundDuePaise: 10000 });

      const check = await app.inject({ method: "GET", url: "/me/deletion", headers: auth(borrower) });
      expect(check.json().canDelete).toBe(false);
      const kinds = (check.json().blockers as { kind: string; bookingId: string }[]).map((x) => [x.bookingId, x.kind] as [string, string]);
      expect(new Map(kinds)).toEqual(
        new Map([
          [live.id, "live_booking"],
          [disputed.id, "open_dispute"],
          [resolved.id, "unpaid_award"],
          [cancelled.id, "refund_owed"],
        ]),
      );
      // The lender is blocked by the same bookings (payee of the award counts too).
      expect((await app.inject({ method: "GET", url: "/me/deletion", headers: auth(lender) })).json().blockers).toHaveLength(4);

      const wrong = await app.inject({ method: "POST", url: "/me/delete", headers: auth(borrower), payload: { password: "not-my-password" } });
      expect(wrong.statusCode).toBe(403);
      expect(wrong.json().error).toBe("wrong_password");
      const refused = await app.inject({ method: "POST", url: "/me/delete", headers: auth(borrower), payload: { password: PASSWORD } });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ error: "account_has_open_obligations", code: "CONFLICT" });
      expect(refused.json().blockers).toHaveLength(4);
      // Nothing changed.
      const [u] = await db.select().from(users).where(eq(users.id, borrower.id));
      expect(u.deletedAt).toBeNull();
    });

    it("anonymises, archives, revokes, drops tokens; can't log in; the email can sign up again", async () => {
      const gone = await signup("leaving", "leaving@example.com");
      const neighbour = await signup("neighbour");
      await member(gone, society, { role: "society_admin" });
      await member(neighbour);
      await db.update(users).set({ upiVpa: "leaving@okaxis" }).where(eq(users.id, gone.id));
      const l = await listing(gone, "Old bike");
      await booking(l, neighbour, "COMPLETED", 20); // finished: not a blocker, and it stays
      await db.insert(pushTokens).values({ userId: gone.id, token: "ExponentPushToken[leaving]", platform: "android" });
      await db.insert(passwordResetTokens).values({ userId: gone.id, tokenHash: "x", expiresAt: new Date(Date.now() + 60_000) });
      await db.insert(userBlocks).values([{ blockerId: gone.id, blockedId: neighbour.id }]);
      await db.insert(adminRequests).values({ kind: "join_admin", requesterId: gone.id, societyId: society, committeeRole: "Secretary", idProofKey: IDDOC(gone.id), status: "approved" });
      await db.insert(adminRequests).values({ kind: "join_admin", requesterId: gone.id, societyId: other, committeeRole: "Secretary", idProofKey: `admin-docs/${gone.id}/00000000-0000-4000-8000-000000000009.pdf`, status: "pending" });
      // Chat history with a neighbour stays (messages are immutable).
      await db.delete(userBlocks).where(eq(userBlocks.blockerId, gone.id));
      const conv = await app.inject({ method: "POST", url: "/conversations", headers: auth(neighbour), payload: { listingId: l.id } });
      await app.inject({ method: "POST", url: `/conversations/${conv.json().id}/messages`, headers: auth(gone), payload: { body: "Sure, take it" } });
      await db.insert(userBlocks).values([{ blockerId: neighbour.id, blockedId: gone.id }]);

      expect((await app.inject({ method: "GET", url: "/me/deletion", headers: auth(gone) })).json()).toEqual({ canDelete: true, blockers: [] });
      purged.keys = [];
      const del = await app.inject({ method: "POST", url: "/me/delete", headers: auth(gone), payload: { password: PASSWORD } });
      expect(del.statusCode).toBe(204);

      const [u] = await db.select().from(users).where(eq(users.id, gone.id));
      expect(u).toMatchObject({
        displayName: "Deleted user",
        email: `deleted+${gone.id}@deleted.invalid`,
        phone: "",
        upiVpa: null,
        isPlatformAdmin: false,
        chatPushEnabled: false,
      });
      expect(u.deletedAt).toBeInstanceOf(Date);
      expect(u.passwordHash.startsWith("$2")).toBe(false);

      for (const t of [sessions, pushTokens, passwordResetTokens]) {
        expect(await db.select().from(t).where(eq(t.userId, gone.id))).toEqual([]);
      }
      expect(await db.select().from(userBlocks).where(sql`${userBlocks.blockerId} = ${gone.id} or ${userBlocks.blockedId} = ${gone.id}`)).toEqual([]);

      const [gl] = await db.select().from(listings).where(eq(listings.id, l.id));
      expect([gl.status, gl.photoKeys]).toEqual(["archived", []]);
      const ms = await db.select().from(memberships).where(eq(memberships.userId, gone.id));
      expect(ms.map((m) => [m.status, m.role, m.proofKey, m.adminSince])).toEqual([["revoked", "resident", null, null]]);
      const ars = await db.select().from(adminRequests).where(eq(adminRequests.requesterId, gone.id));
      expect(ars.map((a) => a.status).sort()).toEqual(["approved", "withdrawn"]);
      expect(ars.every((a) => a.idProofKey === null && a.docsPurgedAt !== null)).toBe(true);
      expect(purged.keys.sort()).toEqual(
        [PHOTO(gone.id), PROOF(gone.id), IDDOC(gone.id), `admin-docs/${gone.id}/00000000-0000-4000-8000-000000000009.pdf`].sort(),
      );

      // Shared records stay: the booking and the message, sender now "Deleted user".
      expect(await db.select().from(bookings).where(eq(bookings.lenderId, gone.id))).toHaveLength(1);
      const msgs = await db.select().from(messages).where(eq(messages.senderId, gone.id));
      expect(msgs.map((m) => m.body)).toEqual(["Sure, take it"]);
      const seen = await app.inject({ method: "GET", url: `/conversations/${conv.json().id}`, headers: auth(neighbour) });
      expect(seen.json().owner.displayName).toBe("Deleted user");
      expect(await db.select().from(conversations).where(eq(conversations.ownerId, gone.id))).toHaveLength(1);

      // Can't get back in.
      expect((await app.inject({ method: "POST", url: "/auth/login", payload: { email: gone.email, password: PASSWORD } })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: gone.refresh } })).statusCode).toBe(401);
      const stale = await app.inject({ method: "GET", url: "/me", headers: auth(gone) });
      expect([stale.statusCode, stale.json().error]).toEqual([401, "account_deleted"]);
      // Nobody can block or report a deleted account.
      expect((await app.inject({ method: "POST", url: `/users/${gone.id}/block`, headers: auth(neighbour) })).statusCode).toBe(404);
      // Browse no longer shows anything of theirs (archived anyway).
      expect(await browseTitles(neighbour)).not.toContain("Old bike");

      // The address is free again, as a brand-new account.
      const again = await signup("back again", "leaving@example.com");
      expect(again.id).not.toBe(gone.id);
    });
  });
});
