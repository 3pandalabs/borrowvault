import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { inspectionMedia, societies } from "../db/schema.js";
import { conflict, forbidden, invalid, notFound } from "../lib/errors.js";
import { clockSkewed, withinGeofence } from "../lib/geo.js";
import { copyObject, deleteObjectQuietly, evidenceKey, finalEvidenceKey, hashObject, presignUpload } from "../plugins/r2.js";
import { loadBooking, partyOf, type Geo } from "./service.js";
import type { BookingState } from "./states.js";

// Evidence integrity (blueprint §1.2):
//  - presigned PUT pins Content-Type + Content-Length
//  - key evidence/<bookingId>/<phase>/<userId>/<uuid>.<ext>, fresh uuid per upload
//  - finalize copies the upload to an immutable evidence-final/ key (no URL ever
//    targets it), re-hashes THAT copy server-side, serves only it; mismatch -> rejected
//  - geofence + clock skew are FLAGS, never blocks
//  - write-once: no route deletes or overwrites media

export type EvidenceMime = "image/jpeg" | "image/png" | "video/mp4" | "video/quicktime";

export const MEDIA_LIMITS: Record<EvidenceMime, number> = {
  "image/jpeg": 15 * 1024 * 1024,
  "image/png": 15 * 1024 * 1024,
  "video/mp4": 100 * 1024 * 1024,
  "video/quicktime": 100 * 1024 * 1024, // iOS camera
};

const PHASE_STATES: Record<"handover" | "return" | "dispute", readonly BookingState[]> = {
  handover: ["HANDOVER_PENDING"],
  return: ["ACTIVE", "OVERDUE", "RETURN_PENDING"],
  dispute: ["HANDOVER_PENDING", "ACTIVE", "OVERDUE", "RETURN_PENDING", "DISPUTED", "COMPLETED"],
};

export async function presignMedia(i: {
  bookingId: string;
  userId: string;
  phase: "handover" | "return" | "dispute";
  slot: string;
  mime: EvidenceMime;
  bytes: number;
  sha256: string;
  /** null/absent = no GPS fix: stored as "no location" (withinGeofence = false). Never rejected. */
  geo?: Geo | null;
}): Promise<{ mediaId: string; uploadUrl: string }> {
  const b = await loadBooking(i.bookingId);
  partyOf(b, i.userId);
  if (!PHASE_STATES[i.phase].includes(b.state)) throw conflict(`no ${i.phase} uploads while ${b.state}`);
  // Inspection evidence is camera-only (app): jpeg/mp4/quicktime. Dispute
  // evidence may come from the web, so png is allowed there too. A missing
  // GPS fix is a flag, never a rejection (basements kill GPS).
  if (i.phase !== "dispute" && i.mime === "image/png") throw invalid("image/png is only accepted for dispute evidence");
  if (i.bytes > MEDIA_LIMITS[i.mime]) throw invalid(`file too large for ${i.mime}`);

  const [soc] = await db.select().from(societies).where(eq(societies.id, b.societyId));
  const key = evidenceKey(b.id, i.phase, i.userId, i.mime);
  const [m] = await db
    .insert(inspectionMedia)
    .values({
      bookingId: b.id,
      uploaderId: i.userId,
      phase: i.phase,
      slot: i.slot,
      r2Key: key,
      mime: i.mime,
      bytes: i.bytes,
      sha256Client: i.sha256.toLowerCase(),
      lat: i.geo?.lat ?? null,
      lng: i.geo?.lng ?? null,
      accuracyM: i.geo?.accuracyM ?? null,
      withinGeofence: i.geo ? withinGeofence(i.geo, soc) : false,
      // Without a device timestamp, capture time = presign time (server clock).
      clientCapturedAt: i.geo ? new Date(i.geo.capturedAt) : new Date(),
    })
    .returning({ id: inspectionMedia.id });
  return { mediaId: m.id, uploadUrl: await presignUpload(key, i.mime, i.bytes) };
}

export async function finalizeMedia(i: { bookingId: string; mediaId: string; userId: string }): Promise<{ ok: true }> {
  if (!/^[0-9a-f-]{36}$/i.test(i.mediaId)) throw notFound();
  const [m] = await db
    .select()
    .from(inspectionMedia)
    .where(and(eq(inspectionMedia.id, i.mediaId), eq(inspectionMedia.bookingId, i.bookingId)))
    .limit(1);
  if (!m) throw notFound();
  if (m.uploaderId !== i.userId) throw forbidden("not your upload");
  if (m.status === "verified") return { ok: true };
  if (m.status === "rejected") throw invalid("this upload was rejected; take the photo again");

  // The presigned PUT URL stays valid for a few minutes, so the staging object
  // could still be overwritten. Copy it server-side to a fresh immutable key no
  // URL ever targets, and verify the hash on THAT copy: what we verify is
  // exactly what we serve, forever.
  const finalKey = finalEvidenceKey(m.r2Key, m.id);
  try {
    await copyObject(m.r2Key, finalKey);
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") throw invalid("upload not found; PUT the file to uploadUrl first");
    throw err;
  }
  const obj = await hashObject(finalKey);
  if (!obj) throw invalid("upload not found; PUT the file to uploadUrl first");

  const ok = obj.sha256 === m.sha256Client && obj.bytes === m.bytes;
  const receivedAt = new Date();
  const won = await db
    .update(inspectionMedia)
    .set({
      sha256Server: obj.sha256,
      receivedAt,
      clockSkewFlag: clockSkewed(m.clientCapturedAt, receivedAt),
      status: ok ? "verified" : "rejected",
      finalKey: ok ? finalKey : null,
    })
    .where(and(eq(inspectionMedia.id, m.id), eq(inspectionMedia.status, "presigned")))
    .returning({ id: inspectionMedia.id });

  // A concurrent finalize already decided this media: discard our copy and report its outcome.
  if (!won.length) {
    await deleteObjectQuietly(finalKey);
    const [cur] = await db.select({ status: inspectionMedia.status }).from(inspectionMedia).where(eq(inspectionMedia.id, m.id));
    if (cur?.status === "verified") return { ok: true };
    throw invalid("upload does not match the device hash; take the photo again");
  }
  if (!ok) {
    await deleteObjectQuietly(finalKey);
    throw invalid("upload does not match the device hash; take the photo again");
  }
  // The staging object is no longer needed (and must never be served).
  await deleteObjectQuietly(m.r2Key);
  return { ok: true };
}
