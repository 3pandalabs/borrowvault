import crypto from "node:crypto";

// Pure (no env): the R2 key layout, shared by plugins/r2.ts and unit tests.

// ---------------------------------------------------------------------------
// Key layout. The owner is encoded in the key so authorization is a string
// comparison, never a bucket listing:
//   proofs/<userId>/<uuid>.<ext>                         residency proof (private)
//   listings/<userId>/<uuid>.<ext>                       listing photos
//   admin-docs/<userId>/<uuid>.<ext>                     admin-request documents (uploader + platform admins only)
//   evidence/<bookingId>/<phase>/<userId>/<uuid>.<ext>   upload STAGING (presigned PUT target), never served
//   evidence-final/<bookingId>/<phase>/<userId>/<mediaId>/<uuid>.<ext>
//       immutable copy made on finalize; the only evidence key ever served. No
//       presigned URL targets evidence-final/, and no route deletes it.
// ---------------------------------------------------------------------------

export const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

export function proofKey(userId: string, mime: string): string {
  return `proofs/${userId}/${crypto.randomUUID()}.${EXT_BY_MIME[mime]}`;
}

export function listingPhotoKey(userId: string, mime: string): string {
  return `listings/${userId}/${crypto.randomUUID()}.${EXT_BY_MIME[mime]}`;
}

/** Admin-request documents. Every presign mints a fresh key; no route overwrites or deletes one. */
export function adminDocKey(userId: string, mime: string): string {
  return `admin-docs/${userId}/${crypto.randomUUID()}.${EXT_BY_MIME[mime]}`;
}

/** A fresh immutable key per finalize attempt, so racing finalizes never share an object. */
export function finalEvidenceKey(uploadKey: string, mediaId: string): string {
  const m = /^evidence\/(.+)\/[^/]+\.([a-z0-9]+)$/i.exec(uploadKey);
  if (!m) throw new Error("not an evidence upload key");
  return `evidence-final/${m[1]}/${mediaId}/${crypto.randomUUID()}.${m[2]}`;
}

export function evidenceKey(bookingId: string, phase: string, userId: string, mime: string): string {
  return `evidence/${bookingId}/${phase}/${userId}/${crypto.randomUUID()}.${EXT_BY_MIME[mime]}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export type ParsedKey =
  | { kind: "proof"; userId: string }
  | { kind: "listing"; userId: string }
  | { kind: "admin_doc"; userId: string }
  | { kind: "evidence"; bookingId: string; userId: string };

export function parseKey(key: string): ParsedKey | null {
  let m = new RegExp(`^proofs/(${UUID})/${UUID}\\.[a-z0-9]+$`, "i").exec(key);
  if (m) return { kind: "proof", userId: m[1] };
  m = new RegExp(`^listings/(${UUID})/${UUID}\\.[a-z0-9]+$`, "i").exec(key);
  if (m) return { kind: "listing", userId: m[1] };
  m = new RegExp(`^admin-docs/(${UUID})/${UUID}\\.(pdf|jpg|png)$`, "i").exec(key);
  if (m) return { kind: "admin_doc", userId: m[1] };
  // Only immutable final keys are ever readable; staging uploads are not.
  m = new RegExp(`^evidence-final/(${UUID})/(handover|return|dispute)/(${UUID})/${UUID}/${UUID}\\.[a-z0-9]+$`, "i").exec(key);
  if (m) return { kind: "evidence", bookingId: m[1], userId: m[3] };
  return null;
}
