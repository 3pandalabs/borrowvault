import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Free listings (api/ROUTES.md "Free listings") end to end against a REAL
// Postgres: the is_free column + listing_has_price_v2 CHECK, the listing
// routes, and a free booking driven through the booking service (the same
// functions the Temporal activities call) with and without a deposit.
// Skipped unless TEST_DATABASE_URL points at a throwaway database (it DROPS
// the public schema), e.g.
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

vi.mock("../src/lib/mailer.js", () => ({
  sendMail: vi.fn(async () => {}),
  simpleMail: vi.fn(() => ({})),
  actionMail: vi.fn(() => ({})),
}));

const RUN = Boolean(process.env.TEST_DATABASE_URL);

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { authPlugin } from "../src/auth/plugin.js";
import * as svc from "../src/booking/service.js";
import { db, pool } from "../src/db/index.js";
import { bookingEvents, bookingPayments, listings, memberships, societies, towers, units, users } from "../src/db/schema.js";
import { DomainError } from "../src/lib/errors.js";
import { authRoutes } from "../src/routes/auth.js";
import { bookingRoutes } from "../src/routes/bookings.js";
import { listingRoutes } from "../src/routes/listings.js";

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
    return reply.code(err.statusCode ?? 500).send({ error: String(err.message) });
  });
  for (const r of [authRoutes, listingRoutes, bookingRoutes]) await app.register(r);
  return app;
}

type Who = { id: string; token: string };
const PHOTO = (u: string) => `listings/${u}/00000000-0000-4000-8000-000000000001.jpg`;
const PROOF = (u: string) => `proofs/${u}/00000000-0000-4000-8000-000000000002.jpg`;

describe.skipIf(!RUN)("free listings (Postgres)", () => {
  let app: FastifyInstance;
  let declaredSoc: string;
  let p2pSoc: string;
  let n = 0;
  const auth = (w: Who) => ({ authorization: `Bearer ${w.token}` });

  async function signup(name: string, societyId: string, upiVpa: string | null = null): Promise<Who> {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: { "cf-connecting-ip": `10.1.0.${++n}` },
      payload: { email: `${name}-${n}@example.com`, password: "correct-horse-battery", displayName: name, phone: "+919876543210" },
    });
    expect(res.statusCode).toBe(201);
    const b = res.json();
    const id = b.user.id as string;
    if (upiVpa) await db.update(users).set({ upiVpa }).where(eq(users.id, id));
    const [t] = await db.select().from(towers).where(eq(towers.societyId, societyId)).limit(1);
    const [unit] = await db.insert(units).values({ towerId: t.id, flatNo: `F${n}` }).returning();
    await db.insert(memberships).values({ userId: id, societyId, unitId: unit.id, role: "resident", status: "approved", occupancy: "owner", proofKey: PROOF(id) });
    return { id, token: b.accessToken };
  }

  /** A free item with no photo slots/checklist, so the test can walk inspections without media uploads. */
  async function freeItem(owner: Who, societyId: string, depositPaise: number) {
    const [l] = await db
      .insert(listings)
      .values({ societyId, ownerId: owner.id, kind: "item", category: "power_tools", title: `Free drill ${++n}`, isFree: true, depositPaise })
      .returning();
    return l;
  }

  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
  const detail = async (id: string, w: Who) => {
    const res = await app.inject({ method: "GET", url: `/bookings/${id}`, headers: auth(w) });
    expect(res.statusCode).toBe(200);
    return res.json();
  };

  /** Handover (both inspect, borrower agrees) → ACTIVE → return → lender agrees → COMPLETED. */
  async function walkToCompleted(bookingId: string, lender: Who, borrower: Who) {
    expect(await svc.openHandover({ bookingId })).toBe("HANDOVER_PENDING");
    await svc.submitInspection({ bookingId, actorId: lender.id, phase: "handover", mediaIds: [], checklistAnswers: {}, geo: null });
    await svc.submitInspection({ bookingId, actorId: borrower.id, phase: "handover", mediaIds: [], checklistAnswers: {}, geo: null });
    expect(await svc.ackInspection({ bookingId, actorId: borrower.id, phase: "handover", result: "agreed" })).toBe("ACTIVE");
    expect(await svc.submitInspection({ bookingId, actorId: borrower.id, phase: "return", mediaIds: [], checklistAnswers: {}, geo: null })).toBe("RETURN_PENDING");
    expect(await svc.ackInspection({ bookingId, actorId: lender.id, phase: "return", result: "agreed" })).toBe("COMPLETED");
  }

  beforeAll(async () => {
    await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await migrate(drizzle(pool), { migrationsFolder: drizzleDir });
    app = await buildApp();
    const [s1] = await db.insert(societies).values({ name: "Declared Towers", city: "Pune", centerLat: 18.5, centerLng: 73.8, status: "live" }).returning();
    const [s2] = await db
      .insert(societies)
      .values({ name: "P2P Park", city: "Pune", centerLat: 18.6, centerLng: 73.9, status: "live", settings: { depositMode: "p2p" } })
      .returning();
    declaredSoc = s1.id;
    p2pSoc = s2.id;
    await db.insert(towers).values([{ societyId: declaredSoc, name: "A" }, { societyId: p2pSoc, name: "B" }]);
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("migration 0009 is idempotent (every statement re-runs cleanly)", async () => {
    const stmts = readFileSync(`${drizzleDir}/0009_free_listings.sql`, "utf8").split("--> statement-breakpoint");
    for (let pass = 0; pass < 2; pass++) for (const s of stmts) if (s.trim()) await pool.query(s);
  });

  it("the v2 CHECK still requires a price on a paid listing", async () => {
    const owner = await signup("checker", declaredSoc);
    await expect(
      db.insert(listings).values({ societyId: declaredSoc, ownerId: owner.id, kind: "item", category: "power_tools", title: "No price" }),
    ).rejects.toThrow();
  });

  describe("listing routes", () => {
    const body = (societyId: string, extra: Record<string, unknown>) => ({
      societyId,
      kind: "item",
      category: "power_tools",
      title: "Ladder",
      description: "",
      depositPaise: 0,
      checklistTemplate: [],
      requiredPhotoSlots: ["front"],
      photoKeys: [],
      ...extra,
    });

    it("creates a free listing: prices ignored, no UPI needed without a deposit, isFree in responses", async () => {
      const owner = await signup("giver", declaredSoc); // no upiVpa
      const res = await app.inject({ method: "POST", url: "/listings", headers: auth(owner), payload: { ...body(declaredSoc, { isFree: true, dailyPaise: 5000 }), photoKeys: [PHOTO(owner.id)] } });
      expect(res.statusCode).toBe(201);
      const l = res.json();
      expect(l).toMatchObject({ isFree: true, hourlyPaise: null, dailyPaise: null, weekendPaise: null });

      const viewer = await signup("viewer", declaredSoc);
      const detailRes = await app.inject({ method: "GET", url: `/listings/${l.id}`, headers: auth(viewer) });
      expect(detailRes.json().isFree).toBe(true);
      const all = (await app.inject({ method: "GET", url: "/listings", headers: auth(viewer) })).json() as { id: string; isFree: boolean }[];
      expect(all.find((x) => x.id === l.id)?.isFree).toBe(true);
    });

    it("a free listing with a deposit still needs a UPI ID; a paid one still needs a price", async () => {
      const owner = await signup("deposit-giver", declaredSoc);
      const withDeposit = await app.inject({ method: "POST", url: "/listings", headers: auth(owner), payload: body(declaredSoc, { isFree: true, depositPaise: 50000 }) });
      expect(withDeposit.statusCode).toBe(400);
      expect(withDeposit.json().error).toMatch(/UPI/);
      await db.update(users).set({ upiVpa: "giver@okbank" }).where(eq(users.id, owner.id));
      expect((await app.inject({ method: "POST", url: "/listings", headers: auth(owner), payload: body(declaredSoc, { isFree: true, depositPaise: 50000 }) })).statusCode).toBe(201);
      const paid = await app.inject({ method: "POST", url: "/listings", headers: auth(owner), payload: body(declaredSoc, {}) });
      expect(paid.statusCode).toBe(400);
      expect(paid.json().error).toMatch(/price/);
    });

    it("PATCH: to free clears prices; back to paid needs a price", async () => {
      const owner = await signup("switcher", declaredSoc, "switch@okbank");
      const created = (await app.inject({ method: "POST", url: "/listings", headers: auth(owner), payload: body(declaredSoc, { dailyPaise: 20000 }) })).json();
      expect(created.isFree).toBe(false);
      const toFree = await app.inject({ method: "PATCH", url: `/listings/${created.id}`, headers: auth(owner), payload: { isFree: true } });
      expect(toFree.statusCode).toBe(200);
      expect(toFree.json()).toMatchObject({ isFree: true, dailyPaise: null });
      expect((await app.inject({ method: "PATCH", url: `/listings/${created.id}`, headers: auth(owner), payload: { isFree: false } })).statusCode).toBe(400);
      const back = await app.inject({ method: "PATCH", url: `/listings/${created.id}`, headers: auth(owner), payload: { isFree: false, hourlyPaise: 3000 } });
      expect(back.json()).toMatchObject({ isFree: false, hourlyPaise: 3000 });
    });

    it("browse ?free=1 returns only free listings", async () => {
      const owner = await signup("mixed", p2pSoc, "mixed@okbank");
      const viewer = await signup("browser", p2pSoc);
      await app.inject({ method: "POST", url: "/listings", headers: auth(owner), payload: body(p2pSoc, { title: "Paid tent", dailyPaise: 10000 }) });
      await app.inject({ method: "POST", url: "/listings", headers: auth(owner), payload: body(p2pSoc, { title: "Free tent", isFree: true }) });
      const free = (await app.inject({ method: "GET", url: `/listings?societyId=${p2pSoc}&free=1`, headers: auth(viewer) })).json() as { title: string; isFree: boolean }[];
      expect(free.map((x) => x.title)).toEqual(["Free tent"]);
      const all = (await app.inject({ method: "GET", url: `/listings?societyId=${p2pSoc}`, headers: auth(viewer) })).json() as { title: string }[];
      expect(all.map((x) => x.title).sort()).toEqual(["Free tent", "Paid tent"]);
    });
  });

  describe("free bookings", () => {
    it("pricing is optional for a free listing and the fee is 0 (any duration up to 30 days, no weekend window)", async () => {
      const lender = await signup("fl", declaredSoc);
      const borrower = await signup("fb", declaredSoc);
      const l = await freeItem(lender, declaredSoc, 0);
      const b = await svc.createBooking({ borrowerId: borrower.id, listingId: l.id, startsAt: inDays(1), endsAt: inDays(4) });
      expect(b).toMatchObject({ feePaise: 0, pricing: "daily" });
      const wk = await svc.createBooking({ borrowerId: borrower.id, listingId: l.id, startsAt: inDays(10), endsAt: inDays(11), pricing: "weekend" });
      expect(wk.feePaise).toBe(0);
      await expect(svc.createBooking({ borrowerId: borrower.id, listingId: l.id, startsAt: inDays(20), endsAt: inDays(52) })).rejects.toThrow(/30 days/);
    });

    it("a paid listing still requires pricing", async () => {
      const lender = await signup("pl", declaredSoc, "pl@okbank");
      const borrower = await signup("pb", declaredSoc);
      const [l] = await db.insert(listings).values({ societyId: declaredSoc, ownerId: lender.id, kind: "item", category: "power_tools", title: "Paid saw", dailyPaise: 10000 }).returning();
      await expect(svc.createBooking({ borrowerId: borrower.id, listingId: l.id, startsAt: inDays(1), endsAt: inDays(2) })).rejects.toThrow(/pricing/);
    });

    it("no deposit: accept skips payment (REQUESTED → ACCEPTED → DEPOSIT_HELD), lender needs no UPI, walks to COMPLETED with nothing owed", async () => {
      const lender = await signup("free-lender", declaredSoc); // no upiVpa
      const borrower = await signup("free-borrower", declaredSoc);
      const l = await freeItem(lender, declaredSoc, 0);
      const b = await svc.createBooking({ borrowerId: borrower.id, listingId: l.id, startsAt: inDays(1), endsAt: inDays(2) });

      expect(await svc.accept({ bookingId: b.id, actorId: lender.id })).toBe("DEPOSIT_HELD");
      const events = await db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, b.id));
      expect(events.map((e) => [e.fromState, e.toState, e.reason])).toEqual([
        [null, "REQUESTED", "requested"],
        ["REQUESTED", "ACCEPTED", "lender_accepted"],
        ["ACCEPTED", "DEPOSIT_HELD", "no_payment_due"],
      ]);
      const asBorrower = await detail(b.id, borrower);
      expect(asBorrower).toMatchObject({ state: "DEPOSIT_HELD", feePaise: 0, nextAction: null });
      expect(asBorrower.payment).toMatchObject({ feePaise: 0, feeUpiIntent: "", depositUpiIntent: null, depositStatus: "none" });
      expect(asBorrower.payment.confirmedAt).not.toBeNull();
      expect((await detail(b.id, lender)).nextAction).toBeNull();
      // There is no payment to claim or confirm.
      await expect(svc.claimPayment({ bookingId: b.id, actorId: borrower.id })).rejects.toThrow(/no payment is due/);
      await expect(svc.confirmPayment({ bookingId: b.id, actorId: lender.id })).rejects.toThrow();
      // Idempotent-retry path still recognises the accept.
      expect((await svc.reconcileAction({ bookingId: b.id, actorId: lender.id, action: "accept" })).applied).toBe(true);

      await walkToCompleted(b.id, lender, borrower);
      const [p] = await db.select().from(bookingPayments).where(eq(bookingPayments.bookingId, b.id));
      expect(p).toMatchObject({ refundDuePaise: 0, depositStatus: "none" });
      expect(await svc.refundOutstanding({ bookingId: b.id })).toBe(false);
      expect((await detail(b.id, borrower)).nextAction).toBe("rate");
    });

    it("no deposit: cancelling after the skipped payment owes no refund", async () => {
      const lender = await signup("cl", declaredSoc);
      const borrower = await signup("cb", declaredSoc);
      const l = await freeItem(lender, declaredSoc, 0);
      const b = await svc.createBooking({ borrowerId: borrower.id, listingId: l.id, startsAt: inDays(1), endsAt: inDays(2) });
      await svc.accept({ bookingId: b.id, actorId: lender.id });
      expect(await svc.cancel({ bookingId: b.id, actorId: borrower.id })).toBe("CANCELLED");
      expect(await svc.refundOutstanding({ bookingId: b.id })).toBe(false);
      expect((await detail(b.id, lender)).nextAction).toBeNull();
    });

    it("declared deposit: nothing moves, so the payment step is skipped too; deposit is declared then released", async () => {
      const lender = await signup("dl", declaredSoc);
      const borrower = await signup("db", declaredSoc);
      const l = await freeItem(lender, declaredSoc, 50000);
      const b = await svc.createBooking({ borrowerId: borrower.id, listingId: l.id, startsAt: inDays(1), endsAt: inDays(2) });
      expect(b).toMatchObject({ feePaise: 0, depositPaise: 50000 });
      expect(await svc.accept({ bookingId: b.id, actorId: lender.id })).toBe("DEPOSIT_HELD");
      expect((await detail(b.id, borrower)).payment).toMatchObject({ depositMode: "declared", depositStatus: "declared", depositUpiIntent: null });
      await walkToCompleted(b.id, lender, borrower);
      const [p] = await db.select().from(bookingPayments).where(eq(bookingPayments.bookingId, b.id));
      expect(p).toMatchObject({ depositStatus: "released", refundDuePaise: 0 });
    });

    it("p2p deposit: payment step covers only the deposit, then refund after completion", async () => {
      const lender = await signup("ql", p2pSoc);
      const borrower = await signup("qb", p2pSoc, "borrower@okbank");
      const l = await freeItem(lender, p2pSoc, 50000);
      const b = await svc.createBooking({ borrowerId: borrower.id, listingId: l.id, startsAt: inDays(1), endsAt: inDays(2) });
      // The deposit goes to the lender's VPA, so the lender needs one to accept.
      await expect(svc.accept({ bookingId: b.id, actorId: lender.id })).rejects.toThrow(/UPI/);
      await db.update(users).set({ upiVpa: "lender@okbank" }).where(eq(users.id, lender.id));
      expect(await svc.accept({ bookingId: b.id, actorId: lender.id })).toBe("ACCEPTED");

      const asBorrower = await detail(b.id, borrower);
      expect(asBorrower.nextAction).toBe("pay");
      expect(asBorrower.payment.feeUpiIntent).toBe("");
      expect(asBorrower.payment.depositUpiIntent).toContain("am=500.00");
      expect((await detail(b.id, lender)).nextAction).toBe("wait_payment");

      await svc.claimPayment({ bookingId: b.id, actorId: borrower.id });
      expect((await detail(b.id, lender)).nextAction).toBe("confirm_payment");
      expect(await svc.confirmPayment({ bookingId: b.id, actorId: lender.id })).toBe("DEPOSIT_HELD");
      expect((await detail(b.id, borrower)).payment.depositStatus).toBe("held_by_lender");

      await walkToCompleted(b.id, lender, borrower);
      expect(await svc.refundOutstanding({ bookingId: b.id })).toBe(true);
      expect((await detail(b.id, lender)).nextAction).toBe("refund_deposit");
      await svc.refundClaim({ bookingId: b.id, actorId: lender.id });
      await svc.refundConfirm({ bookingId: b.id, actorId: borrower.id });
      expect(await svc.refundOutstanding({ bookingId: b.id })).toBe(false);
    });

    it("p2p with no deposit: nothing to pay, payment step skipped", async () => {
      const lender = await signup("zl", p2pSoc);
      const borrower = await signup("zb", p2pSoc);
      const l = await freeItem(lender, p2pSoc, 0);
      const b = await svc.createBooking({ borrowerId: borrower.id, listingId: l.id, startsAt: inDays(1), endsAt: inDays(2) });
      expect(await svc.accept({ bookingId: b.id, actorId: lender.id })).toBe("DEPOSIT_HELD");
    });

    it("free skill: skips payment and the handover", async () => {
      const lender = await signup("sl", declaredSoc);
      const borrower = await signup("sb", declaredSoc);
      const [l] = await db.insert(listings).values({ societyId: declaredSoc, ownerId: lender.id, kind: "skill", category: "tutoring", title: "Free maths help", isFree: true }).returning();
      const b = await svc.createBooking({ borrowerId: borrower.id, listingId: l.id, startsAt: inDays(1), endsAt: inDays(1.1), pricing: "hourly" });
      expect(b.feePaise).toBe(0);
      expect(await svc.accept({ bookingId: b.id, actorId: lender.id })).toBe("DEPOSIT_HELD");
      expect(await svc.openHandover({ bookingId: b.id })).toBe("ACTIVE");
    });
  });
});
