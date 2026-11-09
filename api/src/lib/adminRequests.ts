import { z } from "zod";
import { ADMIN_REQUEST_STATUSES, type adminRequests } from "../db/schema.js";
import { parseKey } from "./storageKeys.js";

// Pure pieces of the admin-request flow (no env, no db), so they're unit-tested:
// request/review body schemas, document-ownership checks, eligibility guards,
// the new-society approval plan, the nomination rules and the AdminRequest
// view (api/ROUTES.md "Admin requests").
//
// Rule: every path to society_admin carries the person's own ID proof.

export type AdminRequestRow = typeof adminRequests.$inferSelect;

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
const docKey = z.string().min(1).max(300);
const committeeRole = trimmed(2, 60);
const statement = z.string().trim().max(1000).optional();

/** Nominations: the nominee has 48 h from accepting until automatic approval. */
export const NOMINATION_AUTO_APPROVE_MS = 48 * 3_600_000;

export const newSocietyRequestBody = z.object({
  kind: z.literal("new_society"),
  societyName: trimmed(2, 120),
  city: trimmed(2, 80),
  address: trimmed(5, 500),
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(50).max(5000),
  towerName: trimmed(1, 60),
  flatNo: trimmed(1, 20),
  occupancy: z.enum(["owner", "tenant", "family"]),
  committeeRole,
  statement,
  // .strict(): RWA certificates and authorisation letters are no longer accepted.
  docs: z.object({ idProofKey: docKey, residenceProofKey: docKey }).strict(),
});

export const joinAdminRequestBody = z.object({
  kind: z.literal("join_admin"),
  societyId: z.string().uuid(),
  committeeRole,
  statement,
  docs: z.object({ idProofKey: docKey }).strict(),
});

export const createAdminRequestBody = z.discriminatedUnion("kind", [newSocietyRequestBody, joinAdminRequestBody]);
export type CreateAdminRequest = z.infer<typeof createAdminRequestBody>;

/** POST /admin/societies/:id/nominations */
export const nominateBody = z.object({
  membershipId: z.string().uuid(),
  committeeRole: committeeRole.optional(),
});

/** POST /admin-requests/:id/accept (the nominee). ID proof is mandatory. */
export const acceptNominationBody = z.object({ idProofKey: docKey, statement }).strict();

export const approveBody = z
  .object({
    note: z.string().trim().max(1000).optional(),
    centerLat: z.number().min(-90).max(90).optional(),
    centerLng: z.number().min(-180).max(180).optional(),
    radiusM: z.number().int().min(50).max(5000).optional(),
  })
  .optional();
export type ApproveBody = z.infer<typeof approveBody>;

/** Reject and revoke-admin: a reason is mandatory. */
export const requiredNoteBody = z.object({ note: z.string().trim().min(5).max(1000) });

export const listStatusQuery = z.object({
  status: z.enum(ADMIN_REQUEST_STATUSES).default("pending"),
});

/** Doc keys as stored, in a fixed order. */
export function docKeysOf(body: CreateAdminRequest): string[] {
  return body.kind === "new_society" ? [body.docs.idProofKey, body.docs.residenceProofKey] : [body.docs.idProofKey];
}

/**
 * Every document must be the caller's own `admin_doc` upload (owner is encoded
 * in the key, same check as proof / listing-photo keys), and the documents
 * must be distinct. Returns a 400 message, or null when fine.
 */
export function ownDocsProblem(userId: string, keys: string[]): string | null {
  for (const k of keys) {
    const p = parseKey(k);
    if (!p || p.kind !== "admin_doc" || p.userId !== userId) return "every document must be your own admin_doc upload";
  }
  if (new Set(keys).size !== keys.length) return "each document must be a separate upload";
  return null;
}

export function docKeyProblem(userId: string, body: CreateAdminRequest): string | null {
  return ownDocsProblem(userId, docKeysOf(body));
}

/**
 * join_admin eligibility from the caller's membership in that society.
 * Not an approved member (none / pending / rejected / revoked) → not_found
 * (404, no existence leak). Already society_admin → already_admin (409).
 */
export function joinAdminEligibility(
  m: { status: string; role: string } | null,
): "not_found" | "already_admin" | "ok" {
  if (!m || m.status !== "approved") return "not_found";
  if (m.role === "society_admin") return "already_admin";
  return "ok";
}

/**
 * Society admins may review/revoke residents, but only a platform admin can
 * remove (or reject) a society_admin membership.
 */
export function societyAdminMayReview(targetRole: string, callerIsPlatformAdmin: boolean): boolean {
  return callerIsPlatformAdmin || targetRole !== "society_admin";
}

type MembershipLite = { id: string; userId: string; societyId: string; status: string; role: string };

/**
 * Who may nominate whom (POST /admin/societies/:id/nominations). The caller
 * needs their own approved society_admin membership there; the target must
 * be another approved, non-admin membership of the same society with no open
 * nomination or pending join_admin request.
 */
export function nominationEligibility(i: {
  caller: { status: string; role: string } | null;
  callerIsPlatformAdmin: boolean;
  callerId: string;
  societyId: string;
  target: MembershipLite | null;
  targetHasOpenRequest: boolean;
}):
  | "not_found"
  | "society_admin_required"
  | "cannot_nominate_self"
  | "nominee_not_approved"
  | "already_admin"
  | "request_pending"
  | "ok" {
  const callerApproved = i.caller?.status === "approved";
  if (!callerApproved && !i.callerIsPlatformAdmin) return "not_found";
  if (!callerApproved || i.caller!.role !== "society_admin") return "society_admin_required";
  if (!i.target || i.target.societyId !== i.societyId) return "not_found";
  if (i.target.userId === i.callerId) return "cannot_nominate_self";
  if (i.target.status !== "approved") return "nominee_not_approved";
  if (i.target.role === "society_admin") return "already_admin";
  if (i.targetHasOpenRequest) return "request_pending";
  return "ok";
}

/** When an accepted nomination is approved automatically. */
export function autoApproveAtFor(acceptedAt: Date): Date {
  return new Date(acceptedAt.getTime() + NOMINATION_AUTO_APPROVE_MS);
}

/** True when the automatic approval may act on this row now. */
export function autoApproveDue(r: Pick<AdminRequestRow, "kind" | "status" | "autoApproveAt">, now: Date): boolean {
  return r.kind === "nominate_admin" && r.status === "pending" && r.autoApproveAt != null && r.autoApproveAt.getTime() <= now.getTime();
}

/**
 * Re-validation before a nomination is approved (manual or automatic): the
 * nominee still has an approved membership and the nominator is still an
 * approved society_admin of that society. Returns the 409 error, or null.
 */
export function nominationApprovalProblem(
  nominee: { status: string } | null,
  nominator: { status: string; role: string } | null,
): "membership_not_active" | "nominator_not_admin" | null {
  if (!nominee || nominee.status !== "approved") return "membership_not_active";
  if (!nominator || nominator.status !== "approved" || nominator.role !== "society_admin") return "nominator_not_admin";
  return null;
}

/** The note stored when the automatic approval closes a nomination instead. */
export function autoCloseNote(problem: "membership_not_active" | "nominator_not_admin"): string {
  return problem === "membership_not_active"
    ? "Closed automatically: the nominee is no longer an approved member of this society."
    : "Closed automatically: the nominating admin is no longer an admin of this society.";
}

/** The tier approving this request creates: new_society → pilot (always). */
export function resultingTier(r: Pick<AdminRequestRow, "kind">): "pilot" | null {
  return r.kind === "new_society" ? "pilot" : null;
}

/** What approving a new_society request inserts (one transaction in the route). */
export function newSocietyPlan(r: AdminRequestRow, o: ApproveBody, reviewerId: string, now: Date) {
  if (r.kind !== "new_society") throw new Error("not a new_society request");
  return {
    society: {
      name: r.societyName!,
      city: r.city!,
      centerLat: o?.centerLat ?? r.centerLat!,
      centerLng: o?.centerLng ?? r.centerLng!,
      radiusM: o?.radiusM ?? r.radiusM!,
      status: "live" as const,
      tier: "pilot" as const, // a platform admin marks it verified later
    },
    towerName: r.towerName!,
    flatNo: r.flatNo!.toUpperCase(),
    membership: {
      userId: r.requesterId,
      role: "society_admin" as const,
      status: "approved" as const,
      occupancy: r.occupancy!,
      via: "admin_request",
      approvedBy: reviewerId,
      approvedAt: now,
      adminSince: now,
    },
  };
}

/** Columns for the insert, from a validated body. */
export function adminRequestInsert(requesterId: string, b: CreateAdminRequest) {
  const common = {
    kind: b.kind,
    requesterId,
    committeeRole: b.committeeRole,
    statement: b.statement ? b.statement : null,
    idProofKey: b.docs.idProofKey,
  };
  if (b.kind === "join_admin") return { ...common, societyId: b.societyId };
  return {
    ...common,
    societyName: b.societyName,
    city: b.city,
    address: b.address,
    centerLat: b.centerLat,
    centerLng: b.centerLng,
    radiusM: b.radiusM,
    towerName: b.towerName,
    flatNo: b.flatNo.toUpperCase(),
    occupancy: b.occupancy,
    residenceProofKey: b.docs.residenceProofKey,
  };
}

/** Columns for a new nomination (status `nominated`, no ID proof yet). */
export function nominationInsert(i: { nomineeId: string; nominatorId: string; societyId: string; committeeRole?: string }) {
  return {
    kind: "nominate_admin" as const,
    status: "nominated" as const,
    requesterId: i.nomineeId,
    nominatedBy: i.nominatorId,
    societyId: i.societyId,
    committeeRole: i.committeeRole || "Co-admin",
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * `AdminRequest` (api/ROUTES.md). `societyName` = the existing society's name
 * (join_admin / nominate_admin) or the proposed one. `nominator` = the
 * nominating admin (nominate_admin only).
 */
export function adminRequestView(
  r: AdminRequestRow,
  existingSocietyName: string | null,
  nominator: { id: string; displayName: string } | null = null,
) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    requesterId: r.requesterId,
    societyId: r.societyId,
    societyName: (r.kind === "new_society" ? r.societyName : existingSocietyName) ?? "",
    proposedSociety:
      r.kind === "new_society"
        ? {
            name: r.societyName!,
            city: r.city!,
            address: r.address!,
            centerLat: r.centerLat!,
            centerLng: r.centerLng!,
            radiusM: r.radiusM!,
            towerName: r.towerName!,
            flatNo: r.flatNo!,
            occupancy: r.occupancy as "owner" | "tenant" | "family",
          }
        : null,
    committeeRole: r.committeeRole,
    statement: r.statement,
    docs: {
      idProofKey: r.idProofKey,
      residenceProofKey: r.residenceProofKey,
      rwaRegistrationKey: r.rwaRegistrationKey,
      authorizationKey: r.authorizationKey,
    },
    nominatedBy: r.kind === "nominate_admin" && r.nominatedBy ? (nominator ?? { id: r.nominatedBy, displayName: "" }) : null,
    nomineeAcceptedAt: iso(r.nomineeAcceptedAt),
    autoApproveAt: iso(r.autoApproveAt),
    reviewNote: r.reviewNote,
    reviewedAt: iso(r.reviewedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
export type AdminRequestView = ReturnType<typeof adminRequestView>;
