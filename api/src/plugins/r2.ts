import crypto from "node:crypto";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env.js";

// R2 is S3-compatible; region "auto".
export const r2 = new S3Client({
  region: "auto",
  endpoint: env.R2_ENDPOINT,
  // Required for presigned PUTs (org checklist). Since SDK v3.729 the default
  // "WHEN_SUPPORTED" signs a CRC32 of the EMPTY body into the URL and R2 then
  // rejects the real upload. Integrity comes from our own server-side SHA-256
  // re-hash on finalize instead.
  requestChecksumCalculation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

const UPLOAD_URL_TTL_SECONDS = 5 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 10 * 60;

/**
 * Presigned PUT with Content-Type AND Content-Length in the signature, so the
 * client can only upload exactly the declared type and size.
 */
export function presignUpload(key: string, contentType: string, bytes: number): Promise<string> {
  return getSignedUrl(
    r2,
    new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, ContentType: contentType, ContentLength: bytes }),
    {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      signableHeaders: new Set(["content-type", "content-length"]),
    },
  );
}

export function presignDownload(key: string): Promise<string> {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }), {
    expiresIn: DOWNLOAD_URL_TTL_SECONDS,
  });
}

/** Streams the object and returns its SHA-256 (hex) and size. null if missing. */
export async function hashObject(key: string): Promise<{ sha256: string; bytes: number } | null> {
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    if (!res.Body) return null;
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    return { sha256: hash.digest("hex"), bytes };
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }
}

/** Server-side copy within the bucket. */
export async function copyObject(fromKey: string, toKey: string): Promise<void> {
  await r2.send(new CopyObjectCommand({ Bucket: env.R2_BUCKET, CopySource: `${env.R2_BUCKET}/${fromKey}`, Key: toKey }));
}

/** Best-effort delete (upload staging keys, losing copies). Never throws. */
export async function deleteObjectQuietly(key: string): Promise<void> {
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  } catch {
    // staging objects can also be swept by an R2 lifecycle rule on evidence/
  }
}

// ---------------------------------------------------------------------------
// Key layout. The owner is encoded in the key so authorization is a string
// comparison, never a bucket listing:
//   proofs/<userId>/<uuid>.<ext>                         residency proof (private)
//   listings/<userId>/<uuid>.<ext>                       listing photos
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
  | { kind: "evidence"; bookingId: string; userId: string };

export function parseKey(key: string): ParsedKey | null {
  let m = new RegExp(`^proofs/(${UUID})/${UUID}\\.[a-z0-9]+$`, "i").exec(key);
  if (m) return { kind: "proof", userId: m[1] };
  m = new RegExp(`^listings/(${UUID})/${UUID}\\.[a-z0-9]+$`, "i").exec(key);
  if (m) return { kind: "listing", userId: m[1] };
  // Only immutable final keys are ever readable; staging uploads are not.
  m = new RegExp(`^evidence-final/(${UUID})/(handover|return|dispute)/(${UUID})/${UUID}/${UUID}\\.[a-z0-9]+$`, "i").exec(key);
  if (m) return { kind: "evidence", bookingId: m[1], userId: m[3] };
  return null;
}
