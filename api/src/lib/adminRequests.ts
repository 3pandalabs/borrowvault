import { z } from "zod";
import type { adminRequests } from "../db/schema.js";
import { parseKey } from "./storageKeys.js";

// Pure pieces of the admin-request flow (no env, no db), so they're unit-tested:
// request/review body schemas, document-ownership checks, eligibility guards,
// the new-society approval plan and the AdminRequest view (api/ROUTES.md).

export type AdminRequestRow = typeof adminRequests.$inferSelect;

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
const docKey = z.string().min(1).max(300);
const committeeRole = trimmed(2, 60);
const statement = z.string().trim().max(1000).optional();

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
  docs: z.object({ rwaRegistrationKey: docKey, authorizationKey: docKey, idProofKey: docKey }).strict(),
});

export const joinAdminRequestBody = z.object({
  kind: z.literal("join_admin"),
  societyId: z.string().uuid(),
  committeeRole,
  statement,
  // .strict(): an RWA certificate is a new_society document; sending one here is a client bug.
  docs: z.object({ authorizationKey: docKey, idProofKey: docKey }).strict(),
});

export const createAdminRequestBody = z.discriminatedUnion("kind", [newSocietyRequestBody, joinAdminRequestBody]);
export type CreateAdminRequest = z.infer<typeof createAdminRequestBody>;

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
  status: z.enum(["pending", "approved", "rejected", "withdrawn"]).default("pending"),
});

/** Doc keys as stored, in a fixed order. */
export function docKeysOf(body: CreateAdminRequest): string[] {
  return body.kind === "new_society"
    ? [body.docs.rwaRegistrationKey, body.docs.authorizationKey, body.docs.idProofKey]
    : [body.docs.authorizationKey, body.docs.idProofKey];
}

/**
 * Every document must be the caller's own `admin_doc` upload (owner is encoded
 * in the key, same check as proof / listing-photo keys), and the documents
 * must be distinct. Returns a 400 message, or null when fine.
 */
export function docKeyProblem(userId: string, body: CreateAdminRequest): string | null {
  const keys = docKeysOf(body);
  for (const k of keys) {
    const p = parseKey(k);
    if (!p || p.kind !== "admin_doc" || p.userId !== userId) return "every document must be your own admin_doc upload";
  }
  if (new Set(keys).size !== keys.length) return "each document must be a separate upload";
  return null;
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
    authorizationKey: b.docs.authorizationKey,
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
    rwaRegistrationKey: b.docs.rwaRegistrationKey,
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** `AdminRequest` (api/ROUTES.md). `societyName` = the existing society's name (join_admin) or the proposed one. */
export function adminRequestView(r: AdminRequestRow, existingSocietyName: string | null) {
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
    docs: { rwaRegistrationKey: r.rwaRegistrationKey, authorizationKey: r.authorizationKey, idProofKey: r.idProofKey },
    reviewNote: r.reviewNote,
    reviewedAt: iso(r.reviewedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
export type AdminRequestView = ReturnType<typeof adminRequestView>;
