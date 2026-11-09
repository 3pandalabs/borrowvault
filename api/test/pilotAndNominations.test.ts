import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminDocKey } from "../src/lib/storageKeys.js";

// Pilot societies + co-admin nominations, end to end through the routes and
// the shared approval function, with Postgres replaced by a scripted fake:
// every db.select()/update()/insert() call takes the next queued result, and
// writes are recorded. db.transaction runs its callback against the same fake.

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

type Write = { op: "update" | "insert"; set?: Record<string, unknown>; values?: Record<string, unknown> };
const fake = vi.hoisted(() => ({
  selects: [] as unknown[][],
  updates: [] as unknown[][],
  inserts: [] as unknown[][],
  writes: [] as Write[],
  platform: false,
  membership: null as null | { status: string; role: string },
}));

vi.mock("../src/db/index.js", () => {
  // A chainable, awaitable stand-in for a Drizzle query builder.
  function chain(result: unknown[], onCall?: (method: string, args: unknown[]) => void): unknown {
    const p: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(result).then(res, rej);
          return (...args: unknown[]) => {
            onCall?.(String(prop), args);
            return p;
          };
        },
      },
    );
    return p;
  }
  const db = {
    select: () => chain(fake.selects.shift() ?? []),
    update: () => {
      const w: Write = { op: "update" };
      fake.writes.push(w);
      return chain(fake.updates.shift() ?? [], (m, a) => {
        if (m === "set") w.set = a[0] as Record<string, unknown>;
      });
    },
    insert: () => {
      const w: Write = { op: "insert" };
      fake.writes.push(w);
      return chain(fake.inserts.shift() ?? [], (m, a) => {
        if (m === "values") w.values = a[0] as Record<string, unknown>;
      });
    },
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db, pool: {} };
});

vi.mock("../src/lib/notify.js", () => ({
  notifyUsers: vi.fn(async () => undefined),
  notifySocietyAdmins: vi.fn(async () => undefined),
  notifyPlatformAdmins: vi.fn(async () => undefined),
}));

vi.mock("../src/lib/authz.js", async (orig) => {
  const real = await orig<typeof import("../src/lib/authz.js")>();
  return {
    ...real,
    isPlatformAdmin: vi.fn(async () => fake.platform),
    approvedMembership: vi.fn(async () => (fake.membership?.status === "approved" ? fake.membership : null)),
    requireApprovedMember: vi.fn(async () => undefined),
    requireSocietyAdmin: vi.fn(async () => undefined),
    isSocietyAdmin: vi.fn(async () => true),
  };
});

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SOCIETY = "33333333-3333-4333-8333-333333333333";
const REQ = "44444444-4444-4444-8444-444444444444";
const MEMBERSHIP = "55555555-5555-4555-8555-555555555555";
const NOMINEE = "66666666-6666-4666-8666-666666666666";

let app: FastifyInstance;
let auth: { authorization: string };

beforeAll(async () => {
  const { authPlugin } = await import("../src/auth/plugin.js");
  const { signAccessToken } = await import("../src/auth/jwt.js");
  const { DomainError } = await import("../src/lib/errors.js");
  const { adminRequestRoutes } = await import("../src/routes/adminRequests.js");
  const { adminRoutes } = await import("../src/routes/admin.js");
  const { listingRoutes } = await import("../src/routes/listings.js");
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err instanceof DomainError) return reply.code(err.status).send({ error: err.message, code: err.code });
    if (err.validation) return reply.code(400).send({ error: err.message, code: "VALIDATION" });
    return reply.code(err.statusCode ?? 500).send({ error: String(err.message) });
  });
  await app.register(authPlugin);
  await app.register(adminRequestRoutes);
  await app.register(adminRoutes);
  await app.register(listingRoutes);
  await app.ready();
  auth = { authorization: `Bearer ${signAccessToken({ sub: ME })}` };
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  fake.selects = [];
  fake.updates = [];
  fake.inserts = [];
  fake.writes = [];
  fake.platform = false;
  fake.membership = null;
});

const T0 = new Date("2026-11-06T10:00:00Z");
const HOUR = 3_600_000;

/** A nomination row as stored. */
function nomination(o: Record<string, unknown> = {}) {
  return {
    id: REQ,
    kind: "nominate_admin",
    requesterId: NOMINEE,
    nominatedBy: ME,
    societyId: SOCIETY,
    societyName: null,
    city: null,
    address: null,
    centerLat: null,
    centerLng: null,
    radiusM: null,
    towerName: null,
    flatNo: null,
    occupancy: null,
    committeeRole: "Co-admin",
    statement: null,
    rwaRegistrationKey: null,
    authorizationKey: null,
    idProofKey: adminDocKey(NOMINEE, "image/png"),
    residenceProofKey: null,
    nomineeAcceptedAt: T0,
    autoApproveAt: new Date(T0.getTime() + 48 * HOUR),
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: T0,
    updatedAt: T0,
    ...o,
  };
}

const approvedResident = { status: "approved", role: "resident" };
const approvedAdmin = { status: "approved", role: "society_admin" };

// ---------------------------------------------------------------------------
// Pilot limits
// ---------------------------------------------------------------------------

describe("pilot member cap (membership approval)", () => {
  const pendingMembership = { id: MEMBERSHIP, userId: OTHER, societyId: SOCIETY, role: "resident", status: "pending" };

  it("approving the 51st member of a pilot → 409 society_full, nothing written", async () => {
    // membership lookup, then (in the tx) the locked society tier, then the approved count
    fake.selects = [[pendingMembership], [{ tier: "pilot" }], [{ n: 50 }]];
    const res = await app.inject({ method: "POST", url: `/admin/memberships/${MEMBERSHIP}/approve`, headers: auth, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "society_full", code: "CONFLICT" });
    expect(fake.writes).toHaveLength(0);
  });
  it("the 50th still fits", async () => {
    fake.selects = [[pendingMembership], [{ tier: "pilot" }], [{ n: 49 }]];
    fake.updates = [[{ id: MEMBERSHIP }]];
    await app.inject({ method: "POST", url: `/admin/memberships/${MEMBERSHIP}/approve`, headers: auth, payload: {} });
    expect(fake.writes[0]?.set).toMatchObject({ status: "approved" });
  });
  it("a verified society has no cap", async () => {
    fake.selects = [[pendingMembership], [{ tier: "verified" }]];
    fake.updates = [[{ id: MEMBERSHIP }]];
    await app.inject({ method: "POST", url: `/admin/memberships/${MEMBERSHIP}/approve`, headers: auth, payload: {} });
    expect(fake.writes[0]?.set).toMatchObject({ status: "approved" });
  });
});

describe("pilot listing value cap", () => {
  const listing = (o: Record<string, unknown> = {}) => ({
    societyId: SOCIETY,
    kind: "item",
    category: "power_tools",
    title: "Bosch drill",
    dailyPaise: 10_000,
    depositPaise: 500_000,
    replacementValuePaise: 500_000,
    checklistTemplate: [],
    requiredPhotoSlots: ["front"],
    photoKeys: [],
    ...o,
  });
  const post = (body: object) => app.inject({ method: "POST", url: "/listings", headers: auth, payload: body });

  it.each([
    ["deposit", { depositPaise: 500_001, replacementValuePaise: null }],
    ["replacement value", { replacementValuePaise: 500_001 }],
  ])("%s over ₹5,000 in a pilot → 400 pilot_value_cap", async (_label, o) => {
    fake.selects = [[{ upiVpa: "me@upi" }], [{ tier: "pilot" }]];
    const res = await post(listing(o));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "pilot_value_cap", code: "VALIDATION" });
    expect(fake.writes).toHaveLength(0);
  });
  it("exactly ₹5,000 is allowed (reaches the insert)", async () => {
    fake.selects = [[{ upiVpa: "me@upi" }], [{ tier: "pilot" }]];
    await post(listing());
    expect(fake.writes[0]?.op).toBe("insert");
  });
  it("a verified society isn't capped", async () => {
    fake.selects = [[{ upiVpa: "me@upi" }], [{ tier: "verified" }]];
    await post(listing({ depositPaise: 2_000_000, replacementValuePaise: 3_000_000 }));
    expect(fake.writes[0]?.op).toBe("insert");
  });
});

describe("platform: mark a pilot verified", () => {
  const societyRow = {
    s: { id: SOCIETY, name: "Lake View", city: "Pune", centerLat: 1, centerLng: 2, radiusM: 300, status: "live", settings: {}, tier: "pilot", verifiedAt: null, createdAt: T0 },
    memberCount: 12,
  };
  it("403 for a non-platform user", async () => {
    const res = await app.inject({ method: "POST", url: `/platform/societies/${SOCIETY}/verify`, headers: auth });
    expect(res.statusCode).toBe(403);
  });
  it("pilot → verified", async () => {
    fake.platform = true;
    fake.selects = [[societyRow]];
    fake.updates = [[{ ...societyRow.s, tier: "verified", verifiedAt: T0 }]];
    const res = await app.inject({ method: "POST", url: `/platform/societies/${SOCIETY}/verify`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tier: "verified", memberCount: 12, verifiedAt: T0.toISOString() });
    expect(fake.writes[0]?.set).toMatchObject({ tier: "verified" });
  });
  it("409 already_verified", async () => {
    fake.platform = true;
    fake.selects = [[{ ...societyRow, s: { ...societyRow.s, tier: "verified" } }]];
    fake.updates = [[]];
    const res = await app.inject({ method: "POST", url: `/platform/societies/${SOCIETY}/verify`, headers: auth });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "already_verified", code: "CONFLICT" });
  });
});

// ---------------------------------------------------------------------------
// Co-admin nominations: routes
// ---------------------------------------------------------------------------

describe("POST /admin/societies/:id/nominations", () => {
  const target = (o: Record<string, unknown> = {}) => ({ id: MEMBERSHIP, userId: NOMINEE, societyId: SOCIETY, status: "approved", role: "resident", ...o });
  const nominate = () =>
    app.inject({ method: "POST", url: `/admin/societies/${SOCIETY}/nominations`, headers: auth, payload: { membershipId: MEMBERSHIP } });

  it("happy path: 201, status nominated, nominator recorded, no ID proof yet", async () => {
    fake.membership = approvedAdmin;
    // target membership, open-request lookup (none); then views(): society info, nominator name
    fake.selects = [[target()], [], [{ id: SOCIETY, name: "Lake View", city: "Pune", tier: "pilot", memberCount: 10 }], [{ id: ME, displayName: "Asha" }]];
    fake.inserts = [[nomination({ status: "nominated", idProofKey: null, nomineeAcceptedAt: null, autoApproveAt: null })]];
    const res = await nominate();
    expect(res.statusCode).toBe(201);
    expect(fake.writes[0]).toMatchObject({
      op: "insert",
      values: { kind: "nominate_admin", status: "nominated", requesterId: NOMINEE, nominatedBy: ME, societyId: SOCIETY },
    });
    expect(res.json()).toMatchObject({ status: "nominated", societyName: "Lake View", nominatedBy: { id: ME, displayName: "Asha" } });
  });
  it("a resident can't nominate (403); a non-member gets 404", async () => {
    fake.membership = approvedResident;
    fake.selects = [[target()], []];
    expect((await nominate()).json()).toEqual({ error: "society_admin_required", code: "FORBIDDEN" });
    fake.membership = null;
    fake.selects = [[target()], []];
    expect((await nominate()).statusCode).toBe(404);
  });
  it("can't nominate yourself (400)", async () => {
    fake.membership = approvedAdmin;
    fake.selects = [[target({ userId: ME })], []];
    const res = await nominate();
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("cannot_nominate_self");
  });
  it("409 for an existing admin, a pending member, or someone with an open request", async () => {
    fake.membership = approvedAdmin;
    fake.selects = [[target({ role: "society_admin" })], []];
    expect((await nominate()).json().error).toBe("already_admin");
    fake.selects = [[target({ status: "pending" })], []];
    expect((await nominate()).json().error).toBe("nominee_not_approved");
    fake.selects = [[target()], [{ id: REQ }]];
    expect((await nominate()).json().error).toBe("request_pending");
    expect(fake.writes).toHaveLength(0);
  });
});

describe("nominee accept / decline", () => {
  const accept = (payload: object) => app.inject({ method: "POST", url: `/admin-requests/${REQ}/accept`, headers: auth, payload });
  const asNominee = () => {
    // The caller (ME) is the nominee here; OTHER nominated them.
    return nomination({ requesterId: ME, nominatedBy: OTHER, status: "nominated", idProofKey: null, nomineeAcceptedAt: null, autoApproveAt: null });
  };

  it("ID proof is required to accept (400 before any lookup)", async () => {
    const res = await accept({ statement: "Happy to help" });
    expect(res.statusCode).toBe(400);
    expect(fake.writes).toHaveLength(0);
  });
  it("someone else's upload is refused", async () => {
    fake.selects = [[asNominee()]];
    const res = await accept({ idProofKey: adminDocKey(OTHER, "image/png") });
    expect(res.statusCode).toBe(400);
    expect(fake.writes).toHaveLength(0);
  });
  it("happy path: pending, ID stored, auto-approve 48 h later", async () => {
    fake.membership = approvedResident;
    const key = adminDocKey(ME, "image/png");
    fake.selects = [[asNominee()]];
    fake.updates = [[{ ...asNominee(), status: "pending", idProofKey: key }]];
    const before = Date.now();
    const res = await accept({ idProofKey: key, statement: "Happy to help" });
    expect(res.statusCode).toBe(200);
    const set = fake.writes[0]!.set!;
    expect(set).toMatchObject({ status: "pending", idProofKey: key, statement: "Happy to help" });
    const accepted = (set.nomineeAcceptedAt as Date).getTime();
    expect(accepted).toBeGreaterThanOrEqual(before);
    expect((set.autoApproveAt as Date).getTime() - accepted).toBe(48 * HOUR);
  });
  it("only the nominee: anyone else gets 404", async () => {
    fake.selects = [[nomination({ status: "nominated" })]]; // requester is NOMINEE, not ME
    expect((await accept({ idProofKey: adminDocKey(ME, "image/png") })).statusCode).toBe(404);
  });
  it("409 not_nominated once already accepted; 409 membership_not_active if no longer a member", async () => {
    fake.selects = [[{ ...asNominee(), status: "pending" }]];
    expect((await accept({ idProofKey: adminDocKey(ME, "image/png") })).json().error).toBe("not_nominated");
    fake.membership = { status: "revoked", role: "resident" };
    fake.selects = [[asNominee()]];
    expect((await accept({ idProofKey: adminDocKey(ME, "image/png") })).json().error).toBe("membership_not_active");
  });
  it("decline", async () => {
    fake.selects = [[asNominee()]];
    fake.updates = [[{ ...asNominee(), status: "declined" }]];
    const res = await app.inject({ method: "POST", url: `/admin-requests/${REQ}/decline`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(fake.writes[0]!.set).toMatchObject({ status: "declined" });
  });
});

describe("nominator cancel", () => {
  const cancel = () => app.inject({ method: "POST", url: `/admin-requests/${REQ}/cancel`, headers: auth });
  it("the nominator can cancel a pending nomination", async () => {
    fake.selects = [[nomination()]];
    fake.updates = [[nomination({ status: "cancelled" })]];
    const res = await cancel();
    expect(res.statusCode).toBe(200);
    expect(fake.writes[0]!.set).toMatchObject({ status: "cancelled" });
  });
  it("anyone else gets 404", async () => {
    fake.selects = [[nomination({ nominatedBy: OTHER })]];
    expect((await cancel()).statusCode).toBe(404);
  });
  it("409 not_pending after approval", async () => {
    fake.selects = [[nomination({ status: "approved" })]];
    fake.updates = [[]];
    expect((await cancel()).json()).toEqual({ error: "not_pending", code: "CONFLICT" });
  });
});

describe("platform reject of a pending nomination", () => {
  it("rejects (manual review beats the 48 h timer)", async () => {
    fake.platform = true;
    fake.selects = [[nomination()]];
    fake.updates = [[nomination({ status: "rejected", reviewNote: "ID is unreadable" })]];
    const res = await app.inject({
      method: "POST",
      url: `/platform/admin-requests/${REQ}/reject`,
      headers: auth,
      payload: { note: "ID is unreadable" },
    });
    expect(res.statusCode).toBe(200);
    expect(fake.writes[0]!.set).toMatchObject({ status: "rejected", reviewedBy: ME });
  });
});

// ---------------------------------------------------------------------------
// Co-admin nominations: the approve function (manual + automatic)
// ---------------------------------------------------------------------------

describe("approveAdminRequest for nominations", () => {
  const due = new Date(T0.getTime() + 49 * HOUR); // beyond 48 h
  const early = new Date(T0.getTime() + 47 * HOUR);
  const approve = async (opts: { now: Date; auto?: boolean; reviewerId?: string | null }) => {
    const { approveAdminRequest } = await import("../src/lib/adminApproval.js");
    return approveAdminRequest(REQ, { reviewerId: opts.reviewerId ?? null, now: opts.now, auto: opts.auto });
  };

  it("auto-approves after 48 h: claims the row and promotes the nominee to society_admin", async () => {
    // locked row, nominee membership, nominator membership
    fake.selects = [[nomination()], [approvedResident], [approvedAdmin]];
    fake.updates = [[nomination({ status: "approved" })], [{ id: MEMBERSHIP }]];
    const res = await approve({ now: due, auto: true });
    expect(res.outcome).toBe("approved");
    expect(fake.writes[0]!.set).toMatchObject({ status: "approved", reviewedBy: null, reviewedAt: due });
    expect(fake.writes[1]!.set).toMatchObject({ role: "society_admin" });
  });
  it("does nothing before 48 h (skipped, no writes)", async () => {
    fake.selects = [[nomination()]];
    expect((await approve({ now: early, auto: true })).outcome).toBe("skipped");
    expect(fake.writes).toHaveLength(0);
  });
  it("is idempotent: an already approved, rejected or cancelled request is skipped", async () => {
    for (const status of ["approved", "rejected", "cancelled", "withdrawn", "nominated"]) {
      fake.selects = [[nomination({ status })]];
      expect((await approve({ now: due, auto: true })).outcome, status).toBe("skipped");
    }
    expect(fake.writes).toHaveLength(0);
  });
  it("re-validation: nominee no longer approved → closed as rejected, nobody promoted", async () => {
    fake.selects = [[nomination()], [{ status: "revoked", role: "resident" }], [approvedAdmin]];
    fake.updates = [[nomination({ status: "rejected" })]];
    const res = await approve({ now: due, auto: true });
    expect(res).toMatchObject({ outcome: "closed", reason: "membership_not_active" });
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]!.set).toMatchObject({ status: "rejected", reviewedBy: null });
    expect(String(fake.writes[0]!.set!.reviewNote)).toMatch(/no longer an approved member/);
  });
  it("re-validation: nominator no longer an admin → closed as rejected", async () => {
    fake.selects = [[nomination()], [approvedResident], [approvedResident]];
    fake.updates = [[nomination({ status: "rejected" })]];
    expect(await approve({ now: due, auto: true })).toMatchObject({ outcome: "closed", reason: "nominator_not_admin" });
    expect(fake.writes.some((w) => w.set?.role === "society_admin")).toBe(false);
  });
  it("platform admin can approve early; re-validation failures are a 409 there", async () => {
    fake.selects = [[nomination()], [approvedResident], [approvedAdmin]];
    fake.updates = [[nomination({ status: "approved" })], [{ id: MEMBERSHIP }]];
    expect((await approve({ now: early, reviewerId: OTHER })).outcome).toBe("approved");
    expect(fake.writes[0]!.set).toMatchObject({ status: "approved", reviewedBy: OTHER });

    fake.writes = [];
    fake.selects = [[nomination()], [approvedResident], [{ status: "approved", role: "resident" }]];
    await expect(approve({ now: early, reviewerId: OTHER })).rejects.toMatchObject({ message: "nominator_not_admin" });
    fake.selects = [[nomination()], [{ status: "revoked", role: "resident" }], [approvedAdmin]];
    await expect(approve({ now: early, reviewerId: OTHER })).rejects.toMatchObject({ message: "membership_not_active" });
    fake.selects = [[nomination({ status: "nominated" })]];
    await expect(approve({ now: early, reviewerId: OTHER })).rejects.toMatchObject({ message: "not_pending" });
    expect(fake.writes).toHaveLength(0);
  });
  it("membership revoked between the check and the promotion → 409 membership_not_active (rolls back)", async () => {
    fake.selects = [[nomination()], [approvedResident], [approvedAdmin]];
    fake.updates = [[nomination({ status: "approved" })], []]; // promotion matched no approved membership
    await expect(approve({ now: early, reviewerId: OTHER })).rejects.toMatchObject({ message: "membership_not_active" });
  });
});

// ---------------------------------------------------------------------------
// Pilot dispute routing: the real assertArbiter (not the mocked exports)
// ---------------------------------------------------------------------------

describe("disputes in a pilot are ruled by platform admins", () => {
  const booking = { societyId: SOCIETY, lenderId: OTHER, borrowerId: NOMINEE };
  const arbiter = async () => (await vi.importActual<typeof import("../src/lib/authz.js")>("../src/lib/authz.js")).assertArbiter;

  it("a society admin of a pilot gets 403 pilot_platform_rules", async () => {
    // approvedMembership (society admin), society tier, isPlatformAdmin
    fake.selects = [[{ role: "society_admin", status: "approved" }], [{ tier: "pilot" }], [{ a: false }]];
    await expect((await arbiter())(ME, booking)).rejects.toMatchObject({ code: "FORBIDDEN", message: "pilot_platform_rules" });
  });
  it("a platform admin may rule in a pilot (arbiter rule still checked)", async () => {
    // approvedMembership (none) → isPlatformAdmin true; tier; isPlatformAdmin; unit check (no shared unit)
    fake.selects = [[], [{ a: true }], [{ tier: "pilot" }], [{ a: true }], []];
    await expect((await arbiter())(ME, booking)).resolves.toBeUndefined();
  });
  it("a platform admin who is a party still can't rule", async () => {
    await expect((await arbiter())(OTHER, booking)).rejects.toMatchObject({ message: "parties cannot arbitrate" });
  });
  it("a platform admin living in a party's unit still can't rule", async () => {
    const UNIT = "77777777-7777-4777-8777-777777777777";
    fake.selects = [
      [],
      [{ a: true }],
      [{ tier: "pilot" }],
      [{ a: true }],
      [
        { userId: ME, unitId: UNIT, status: "approved" },
        { userId: OTHER, unitId: UNIT, status: "approved" },
      ],
    ];
    await expect((await arbiter())(ME, booking)).rejects.toMatchObject({ message: "arbiter lives in a party's unit" });
  });
  it("a verified society's admin may rule as before", async () => {
    fake.selects = [[{ role: "society_admin", status: "approved" }], [{ tier: "verified" }], [{ a: false }], []];
    await expect((await arbiter())(ME, booking)).resolves.toBeUndefined();
  });
});
