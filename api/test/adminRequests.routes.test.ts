import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminDocKey } from "../src/lib/storageKeys.js";

// Route-level checks through fastify.inject, with the database and the
// role lookups mocked (no Postgres in the unit-test run). Env is set before
// any app module loads, since env.ts validates at import.
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

const state = vi.hoisted(() => ({ platform: false, selectRows: [] as unknown[], emailVerified: true }));

vi.mock("../src/lib/emailVerification.js", async () => {
  const { forbidden } = await import("../src/lib/errors.js");
  return {
    assertEmailVerified: vi.fn(async () => {
      if (!state.emailVerified) throw forbidden("email_unverified");
    }),
  };
});

vi.mock("../src/lib/authz.js", () => ({
  isPlatformAdmin: vi.fn(async () => state.platform),
  requireSocietyAdmin: vi.fn(async () => undefined), // caller IS a society admin of that society
  isSocietyAdmin: vi.fn(async () => true),
  approvedSocietyIds: vi.fn(async () => []),
  requireApprovedMember: vi.fn(async () => undefined),
  approvedMembership: vi.fn(async () => null),
  assertArbiter: vi.fn(async () => undefined),
  sharesUnitWithParty: vi.fn(async () => false),
  unitLabels: vi.fn(async () => new Map()),
}));

// Any select chain resolves to state.selectRows; writes must not be reached.
vi.mock("../src/db/index.js", () => {
  const chain: Record<string, unknown> = {};
  const thenable = new Proxy(chain, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => void) => res(state.selectRows);
      return () => thenable;
    },
  });
  const fail = () => {
    throw new Error("unexpected write in test");
  };
  return { db: { select: () => thenable, update: fail, insert: fail, transaction: fail }, pool: {} };
});

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SOCIETY = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP = "55555555-5555-4555-8555-555555555555";

let app: FastifyInstance;
let auth: { authorization: string };

beforeAll(async () => {
  const { authPlugin } = await import("../src/auth/plugin.js");
  const { signAccessToken } = await import("../src/auth/jwt.js");
  const { DomainError } = await import("../src/lib/errors.js");
  const { adminRequestRoutes } = await import("../src/routes/adminRequests.js");
  const { adminRoutes } = await import("../src/routes/admin.js");
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Same mapping as index.ts's error handler.
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err instanceof DomainError) return reply.code(err.status).send({ error: err.message, code: err.code });
    if (err.validation) return reply.code(400).send({ error: err.message, code: "VALIDATION" });
    return reply.code(err.statusCode ?? 500).send({ error: String(err.message) });
  });
  await app.register(authPlugin);
  await app.register(adminRequestRoutes);
  await app.register(adminRoutes);
  await app.ready();
  auth = { authorization: `Bearer ${signAccessToken({ sub: ME })}` };
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  state.platform = false;
  state.selectRows = [];
  state.emailVerified = true;
});

describe("platform-only routes", () => {
  const routes: [string, string, unknown?][] = [
    ["GET", "/platform/admin-requests"],
    ["GET", "/platform/admin-requests?status=approved"],
    ["POST", `/platform/admin-requests/${OTHER}/approve`, {}],
    ["POST", `/platform/admin-requests/${OTHER}/reject`, { note: "documents unreadable" }],
    ["GET", `/platform/societies/${SOCIETY}/admins`],
    ["POST", `/platform/societies/${SOCIETY}/admins/${MEMBERSHIP}/revoke-admin`, { note: "stepped down" }],
  ];
  it.each(routes)("%s %s → 403 for a non-platform user", async (method, url, payload) => {
    const res = await app.inject({ method: method as "GET" | "POST", url, headers: auth, payload: payload as object });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "platform_admin_required", code: "FORBIDDEN" });
  });
  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/platform/admin-requests" });
    expect(res.statusCode).toBe(401);
  });
  it("reject needs a note (400 before any lookup)", async () => {
    state.platform = true;
    const res = await app.inject({ method: "POST", url: `/platform/admin-requests/${OTHER}/reject`, headers: auth, payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /admin-requests validation", () => {
  const join = (docs: Record<string, string>) => ({ kind: "join_admin", societyId: SOCIETY, committeeRole: "Treasurer", docs });

  it("403 email_unverified before anything else for an unverified caller", async () => {
    state.emailVerified = false;
    const res = await app.inject({
      method: "POST",
      url: "/admin-requests",
      headers: auth,
      payload: join({ idProofKey: adminDocKey(ME, "image/png") }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "email_unverified", code: "FORBIDDEN" });
  });
  it("400 when a document isn't the caller's own upload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin-requests",
      headers: auth,
      payload: join({ idProofKey: adminDocKey(OTHER, "image/png") }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
  });
  it("400 when new_society lacks the residence proof (an old-style authorisation letter is refused)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin-requests",
      headers: auth,
      payload: {
        kind: "new_society",
        societyName: "Green Meadows",
        city: "Pune",
        address: "Baner Road, Pune",
        centerLat: 18.5,
        centerLng: 73.8,
        radiusM: 300,
        towerName: "A",
        flatNo: "101",
        occupancy: "owner",
        committeeRole: "Secretary",
        docs: { authorizationKey: adminDocKey(ME, "application/pdf"), idProofKey: adminDocKey(ME, "image/png") },
      },
    });
    expect(res.statusCode).toBe(400);
  });
  it("404 for join_admin when the caller has no approved membership there", async () => {
    state.selectRows = [{ status: "pending", role: "resident", societyName: "Lake View" }];
    const res = await app.inject({
      method: "POST",
      url: "/admin-requests",
      headers: auth,
      payload: join({ idProofKey: adminDocKey(ME, "image/png") }),
    });
    expect(res.statusCode).toBe(404);
  });
  it("409 already_admin for join_admin by an existing admin", async () => {
    state.selectRows = [{ status: "approved", role: "society_admin", societyName: "Lake View" }];
    const res = await app.inject({
      method: "POST",
      url: "/admin-requests",
      headers: auth,
      payload: join({ idProofKey: adminDocKey(ME, "image/png") }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "already_admin", code: "CONFLICT" });
  });
  it("409 request_pending when a pending request already exists", async () => {
    // Both selects (membership, then pending lookup) see this row: an approved
    // resident membership, and a truthy pending row.
    state.selectRows = [{ id: OTHER, status: "approved", role: "resident", societyName: "Lake View" }];
    const res = await app.inject({
      method: "POST",
      url: "/admin-requests",
      headers: auth,
      payload: join({ idProofKey: adminDocKey(ME, "image/png") }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "request_pending", code: "CONFLICT" });
  });
});

describe("society admin can't remove an admin", () => {
  const target = (role: string, status: string) => ({ id: MEMBERSHIP, userId: OTHER, societyId: SOCIETY, role, status });

  it.each(["revoke", "reject"])("POST /admin/memberships/:id/%s on a society_admin → 403 admin_membership_platform_only", async (action) => {
    state.selectRows = [target("society_admin", action === "revoke" ? "approved" : "pending")];
    const res = await app.inject({ method: "POST", url: `/admin/memberships/${MEMBERSHIP}/${action}`, headers: auth, payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "admin_membership_platform_only", code: "FORBIDDEN" });
  });
  it("revoking a resident still goes through to the write", async () => {
    state.selectRows = [target("resident", "approved")];
    const res = await app.inject({ method: "POST", url: `/admin/memberships/${MEMBERSHIP}/revoke`, headers: auth, payload: {} });
    // Reaches db.update, which the mock refuses: proves the guard let it through.
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/unexpected write/);
  });
});
