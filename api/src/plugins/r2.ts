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


// Key layout lives in lib/storageKeys.ts (pure, unit-tested); re-exported here.
export * from "../lib/storageKeys.js";
