import { describe, expect, it } from "vitest";
import {
  type AdminRequestRow,
  adminRequestInsert,
  adminRequestView,
  approveBody,
  createAdminRequestBody,
  docKeyProblem,
  joinAdminEligibility,
  listStatusQuery,
  newSocietyPlan,
  requiredNoteBody,
  societyAdminMayReview,
} from "../src/lib/adminRequests.js";
import { adminDocKey, parseKey, proofKey } from "../src/lib/storageKeys.js";

// Pure pieces of the admin-request flow. The DB side (transaction, partial
// unique indexes) is exercised by the route tests' mocks and by hand against
// Postgres; vitest here runs without a database (see vitest.config.ts).

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SOCIETY = "33333333-3333-4333-8333-333333333333";

const doc = (owner = ME, mime = "application/pdf") => adminDocKey(owner, mime);

function newSociety(overrides: Record<string, unknown> = {}) {
  return {
    kind: "new_society",
    societyName: "Green Meadows",
    city: "Pune",
    address: "Baner Road, Pune 411045",
    centerLat: 18.56,
    centerLng: 73.78,
    radiusM: 300,
    towerName: "A",
    flatNo: "1203b",
    occupancy: "owner",
    committeeRole: "Secretary",
    docs: { rwaRegistrationKey: doc(), authorizationKey: doc(), idProofKey: doc() },
    ...overrides,
  };
}

function joinAdmin(overrides: Record<string, unknown> = {}) {
  return {
    kind: "join_admin",
    societyId: SOCIETY,
    committeeRole: "Committee member",
    docs: { authorizationKey: doc(), idProofKey: doc() },
    ...overrides,
  };
}

describe("admin_doc storage keys", () => {
  it("parse as admin_doc with the uploader encoded", () => {
    for (const mime of ["application/pdf", "image/jpeg", "image/png"]) {
      const k = adminDocKey(ME, mime);
      expect(k.startsWith(`admin-docs/${ME}/`)).toBe(true);
      expect(parseKey(k)).toEqual({ kind: "admin_doc", userId: ME });
    }
  });
  it("other prefixes and odd extensions are not admin docs", () => {
    expect(parseKey(proofKey(ME, "application/pdf"))?.kind).toBe("proof");
    expect(parseKey(`admin-docs/${ME}/${OTHER}.exe`)).toBeNull();
    expect(parseKey(`admin-docs/${ME}/../${OTHER}.pdf`)).toBeNull();
  });
});

describe("create body: required docs per kind", () => {
  it("accepts a complete new_society and join_admin request", () => {
    expect(createAdminRequestBody.safeParse(newSociety()).success).toBe(true);
    expect(createAdminRequestBody.safeParse(joinAdmin()).success).toBe(true);
  });
  it("new_society needs all three documents", () => {
    for (const missing of ["rwaRegistrationKey", "authorizationKey", "idProofKey"]) {
      const docs: Record<string, string> = { rwaRegistrationKey: doc(), authorizationKey: doc(), idProofKey: doc() };
      delete docs[missing];
      expect(createAdminRequestBody.safeParse(newSociety({ docs })).success, missing).toBe(false);
    }
  });
  it("join_admin needs authorization + ID proof, and refuses an RWA certificate", () => {
    expect(createAdminRequestBody.safeParse(joinAdmin({ docs: { authorizationKey: doc() } })).success).toBe(false);
    expect(createAdminRequestBody.safeParse(joinAdmin({ docs: { idProofKey: doc() } })).success).toBe(false);
    expect(
      createAdminRequestBody.safeParse(joinAdmin({ docs: { authorizationKey: doc(), idProofKey: doc(), rwaRegistrationKey: doc() } }))
        .success,
    ).toBe(false);
  });
  it("join_admin needs a societyId; unknown kinds are rejected", () => {
    expect(createAdminRequestBody.safeParse(joinAdmin({ societyId: undefined })).success).toBe(false);
    expect(createAdminRequestBody.safeParse(joinAdmin({ kind: "promote" })).success).toBe(false);
  });
  it("validates the proposed geofence and fields", () => {
    expect(createAdminRequestBody.safeParse(newSociety({ radiusM: 49 })).success).toBe(false);
    expect(createAdminRequestBody.safeParse(newSociety({ radiusM: 5001 })).success).toBe(false);
    expect(createAdminRequestBody.safeParse(newSociety({ centerLat: 91 })).success).toBe(false);
    expect(createAdminRequestBody.safeParse(newSociety({ occupancy: "landlord" })).success).toBe(false);
    expect(createAdminRequestBody.safeParse(newSociety({ committeeRole: " " })).success).toBe(false);
    expect(createAdminRequestBody.safeParse(newSociety({ statement: "x".repeat(1001) })).success).toBe(false);
  });
});

describe("document ownership", () => {
  const parse = (b: unknown) => createAdminRequestBody.parse(b);
  it("own admin_doc uploads pass", () => {
    expect(docKeyProblem(ME, parse(newSociety()))).toBeNull();
    expect(docKeyProblem(ME, parse(joinAdmin()))).toBeNull();
  });
  it("someone else's upload is refused", () => {
    const b = parse(joinAdmin({ docs: { authorizationKey: doc(OTHER), idProofKey: doc() } }));
    expect(docKeyProblem(ME, b)).toMatch(/your own admin_doc/);
  });
  it("a key of another purpose (residency proof) is refused", () => {
    const b = parse(newSociety({ docs: { rwaRegistrationKey: proofKey(ME, "application/pdf"), authorizationKey: doc(), idProofKey: doc() } }));
    expect(docKeyProblem(ME, b)).toMatch(/your own admin_doc/);
  });
  it("garbage keys are refused", () => {
    const b = parse(joinAdmin({ docs: { authorizationKey: "admin-docs/whatever.pdf", idProofKey: doc() } }));
    expect(docKeyProblem(ME, b)).not.toBeNull();
  });
  it("the same upload can't be used for two documents", () => {
    const k = doc();
    expect(docKeyProblem(ME, parse(joinAdmin({ docs: { authorizationKey: k, idProofKey: k } })))).toMatch(/separate/);
  });
});

describe("join_admin eligibility", () => {
  it("no membership, or one that isn't approved, is a 404 (no existence leak)", () => {
    expect(joinAdminEligibility(null)).toBe("not_found");
    for (const status of ["pending", "rejected", "revoked"]) {
      expect(joinAdminEligibility({ status, role: "resident" })).toBe("not_found");
    }
  });
  it("already an admin → already_admin", () => {
    expect(joinAdminEligibility({ status: "approved", role: "society_admin" })).toBe("already_admin");
  });
  it("approved resident → ok", () => {
    expect(joinAdminEligibility({ status: "approved", role: "resident" })).toBe("ok");
  });
});

describe("society admins can't remove an admin", () => {
  it("a society admin may review residents but not admins", () => {
    expect(societyAdminMayReview("resident", false)).toBe(true);
    expect(societyAdminMayReview("society_admin", false)).toBe(false);
  });
  it("a platform admin may", () => {
    expect(societyAdminMayReview("society_admin", true)).toBe(true);
  });
});

describe("review bodies", () => {
  it("reject / revoke-admin need a note of at least 5 chars", () => {
    expect(requiredNoteBody.safeParse({}).success).toBe(false);
    expect(requiredNoteBody.safeParse({ note: "no" }).success).toBe(false);
    expect(requiredNoteBody.safeParse({ note: "   abc    " }).success).toBe(false);
    expect(requiredNoteBody.safeParse({ note: "Authorisation letter is unsigned" }).success).toBe(true);
  });
  it("approve body is optional; overrides are range-checked", () => {
    expect(approveBody.safeParse(undefined).success).toBe(true);
    expect(approveBody.safeParse({ radiusM: 20 }).success).toBe(false);
    expect(approveBody.safeParse({ note: "ok", radiusM: 400 }).success).toBe(true);
  });
  it("list status defaults to pending", () => {
    expect(listStatusQuery.parse({})).toEqual({ status: "pending" });
    expect(listStatusQuery.safeParse({ status: "everything" }).success).toBe(false);
  });
});

function rowFrom(insert: ReturnType<typeof adminRequestInsert>, extra: Partial<AdminRequestRow> = {}): AdminRequestRow {
  const t = new Date("2026-11-06T10:00:00Z");
  return {
    id: "44444444-4444-4444-8444-444444444444",
    societyId: null,
    societyName: null,
    city: null,
    address: null,
    centerLat: null,
    centerLng: null,
    radiusM: null,
    towerName: null,
    flatNo: null,
    occupancy: null,
    rwaRegistrationKey: null,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: t,
    updatedAt: t,
    ...insert,
    ...extra,
  } as AdminRequestRow;
}

describe("approving a new_society request", () => {
  const body = createAdminRequestBody.parse(newSociety());
  const row = rowFrom(adminRequestInsert(ME, body));
  const now = new Date("2026-11-07T00:00:00Z");

  it("plans a live society, its tower, the requester's unit and an approved society_admin membership", () => {
    const plan = newSocietyPlan(row, undefined, OTHER, now);
    expect(plan.society).toEqual({ name: "Green Meadows", city: "Pune", centerLat: 18.56, centerLng: 73.78, radiusM: 300, status: "live" });
    expect(plan.towerName).toBe("A");
    expect(plan.flatNo).toBe("1203B");
    expect(plan.membership).toEqual({
      userId: ME,
      role: "society_admin",
      status: "approved",
      occupancy: "owner",
      via: "admin_request",
      approvedBy: OTHER,
      approvedAt: now,
      adminSince: now,
    });
  });
  it("platform geofence overrides win over the proposal", () => {
    const plan = newSocietyPlan(row, { centerLat: 18.6, radiusM: 800 }, OTHER, now);
    expect(plan.society).toMatchObject({ centerLat: 18.6, centerLng: 73.78, radiusM: 800 });
  });
  it("refuses a join_admin row", () => {
    const j = rowFrom(adminRequestInsert(ME, createAdminRequestBody.parse(joinAdmin())));
    expect(() => newSocietyPlan(j, undefined, OTHER, now)).toThrow();
  });
});

describe("AdminRequest view", () => {
  it("new_society: proposedSociety + RWA key, societyName is the proposal", () => {
    const v = adminRequestView(rowFrom(adminRequestInsert(ME, createAdminRequestBody.parse(newSociety()))), null);
    expect(v.kind).toBe("new_society");
    expect(v.societyId).toBeNull();
    expect(v.societyName).toBe("Green Meadows");
    expect(v.proposedSociety).toMatchObject({ name: "Green Meadows", towerName: "A", flatNo: "1203B", occupancy: "owner" });
    expect(v.docs.rwaRegistrationKey).toMatch(/^admin-docs\//);
    expect(v.reviewedAt).toBeNull();
    expect(v.createdAt).toBe("2026-11-06T10:00:00.000Z");
  });
  it("join_admin: society name comes from the existing society; no proposal, no RWA key", () => {
    const v = adminRequestView(rowFrom(adminRequestInsert(ME, createAdminRequestBody.parse(joinAdmin({ statement: "  " })))), "Lake View");
    expect(v.societyId).toBe(SOCIETY);
    expect(v.societyName).toBe("Lake View");
    expect(v.proposedSociety).toBeNull();
    expect(v.docs.rwaRegistrationKey).toBeNull();
    expect(v.statement).toBeNull();
  });
});
