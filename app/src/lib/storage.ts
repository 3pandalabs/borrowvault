import { File, UploadType } from "expo-file-system";
import { presignStorage } from "./api";
import type { PresignPurpose } from "./types";

export const PROOF_MIMES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const LISTING_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PROOF_MAX = 10 * 1024 * 1024;
export const LISTING_MAX = 8 * 1024 * 1024;

export function guessMime(uri: string, fallback = "image/jpeg"): string {
  const ext = uri.split("?")[0].split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return fallback;
  }
}

/** POST /storage/presign then PUT the bytes. Returns the storage key. */
export async function uploadToStorage(purpose: PresignPurpose, uri: string, mime: string): Promise<string> {
  const file = new File(uri);
  const bytes = file.size;
  const max = purpose === "proof" ? PROOF_MAX : LISTING_MAX;
  const allowed: readonly string[] = purpose === "proof" ? PROOF_MIMES : LISTING_MIMES;
  if (!allowed.includes(mime)) throw new Error(`That file type isn't supported (${mime}).`);
  if (bytes > max) throw new Error(`File is too large (max ${max / 1024 / 1024} MB).`);

  const { key, uploadUrl } = await presignStorage({ purpose, mime, bytes });
  const res = await file.upload(uploadUrl, {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    headers: { "Content-Type": mime },
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`Upload failed (HTTP ${res.status}). Please retry.`);
  return key;
}
