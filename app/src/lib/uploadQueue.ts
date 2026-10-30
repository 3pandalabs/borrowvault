// Evidence upload queue: survives app restarts and flaky basement networks.
//
// Every captured photo/video is copied into the app's document directory,
// hashed (SHA-256 over the file bytes), and persisted as a queue item BEFORE
// any network call. A single worker then walks each item through
//   presign → PUT bytes (exact Content-Type) → finalize (server re-hashes)
// with exponential backoff, and resumes on reconnect / app foreground.
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths, UploadType } from "expo-file-system";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { ApiError, finalizeMedia, isTransient, presignMedia } from "./api";
import { sha256Hex } from "./hash";
import type { Geo, MediaMime, MediaPhase } from "./types";

export type UploadStatus =
  | "queued" // waiting for its turn / for the network
  | "uploading" // presign + PUT in progress
  | "finalizing" // server is re-hashing
  | "verified" // finalize returned ok: usable in an inspection/dispute
  | "rejected"; // permanent failure (e.g. hash mismatch): retake needed

export type QueueItem = {
  localId: string;
  bookingId: string;
  phase: MediaPhase;
  slot: string;
  mime: MediaMime;
  localUri: string;
  bytes: number;
  sha256: string;
  geo: Geo | null;
  createdAt: string;
  status: UploadStatus;
  mediaId: string | null;
  uploadUrl: string | null;
  uploaded: boolean;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
};

const STORAGE_KEY = "borrowvault_upload_queue_v1";
const MAX_BACKOFF_MS = 60_000;

let items: QueueItem[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<(items: QueueItem[]) => void>();
let running = false;
let rerun = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function evidenceDir(): Directory {
  const dir = new Directory(Paths.document, "evidence");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function ensureLoaded(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        items = raw ? (JSON.parse(raw) as QueueItem[]) : [];
      } catch {
        items = [];
      }
      // An upload that was mid-flight when the app died must restart cleanly.
      items = items.map((i) =>
        i.status === "uploading" || i.status === "finalizing" ? { ...i, status: "queued", nextAttemptAt: 0 } : i,
      );
      startTriggers();
    })();
  }
  return loaded;
}

async function persist() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // storage full: the in-memory queue still works for this session
  }
}

function emit() {
  const snap = items.slice();
  listeners.forEach((l) => l(snap));
}

function update(localId: string, patch: Partial<QueueItem>) {
  const i = items.findIndex((x) => x.localId === localId);
  if (i === -1) return; // superseded/cleared while in flight
  items[i] = { ...items[i], ...patch };
  emit();
  void persist();
}

function deleteFile(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}

/** SHA-256 hex over the exact bytes we'll PUT (expo-crypto native digest). */
export async function hashFile(uri: string): Promise<{ sha256: string; bytes: number }> {
  const file = new File(uri);
  const data = await file.bytes();
  const sha256 = await sha256Hex(data, (d) => Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, d));
  return { sha256, bytes: data.byteLength };
}

/**
 * Persist + hash + enqueue a fresh capture. Replaces any earlier capture for
 * the same booking/phase/slot (a retake), so only the latest one is submitted.
 */
export async function enqueueCapture(input: {
  bookingId: string;
  phase: MediaPhase;
  slot: string;
  mime: MediaMime;
  sourceUri: string;
  geo: Geo | null;
}): Promise<QueueItem> {
  await ensureLoaded();
  const localId = Crypto.randomUUID();
  const ext = input.mime === "video/quicktime" ? "mov" : input.mime === "video/mp4" ? "mp4" : "jpg";
  const dest = new File(evidenceDir(), `${localId}.${ext}`);
  const src = new File(input.sourceUri);
  src.copySync(dest); // cache dir can be purged by the OS; documents can't
  try {
    src.delete();
  } catch {
    // best effort
  }
  const { sha256, bytes } = await hashFile(dest.uri);

  const item: QueueItem = {
    localId,
    bookingId: input.bookingId,
    phase: input.phase,
    slot: input.slot,
    mime: input.mime,
    localUri: dest.uri,
    bytes,
    sha256,
    geo: input.geo,
    createdAt: new Date().toISOString(),
    status: "queued",
    mediaId: null,
    uploadUrl: null,
    uploaded: false,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
  };

  const replaced = items.filter(
    (i) => i.bookingId === input.bookingId && i.phase === input.phase && i.slot === input.slot,
  );
  replaced.forEach((r) => deleteFile(r.localUri));
  items = items.filter((i) => !replaced.includes(i)).concat(item);
  emit();
  await persist();
  kick();
  return item;
}

/** Manual retry for a rejected or backing-off item. */
export function retryItem(localId: string) {
  const it = items.find((i) => i.localId === localId);
  if (!it || it.status === "verified") return;
  // A rejected item restarts from a fresh presign (new write-once key).
  update(localId, {
    status: "queued",
    nextAttemptAt: 0,
    lastError: null,
    ...(it.status === "rejected" ? { mediaId: null, uploadUrl: null, uploaded: false } : {}),
  });
  kick();
}

/** Drop local copies once an inspection/dispute that used them is accepted by the server. */
export async function clearItems(bookingId: string, phase: MediaPhase, slots?: string[]) {
  await ensureLoaded();
  const gone = items.filter(
    (i) => i.bookingId === bookingId && i.phase === phase && (!slots || slots.includes(i.slot)),
  );
  gone.forEach((g) => deleteFile(g.localUri));
  items = items.filter((i) => !gone.includes(i));
  emit();
  await persist();
}

export function kick() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  void run();
}

async function run() {
  await ensureLoaded();
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      const now = Date.now();
      const due = items.filter(
        (i) => (i.status === "queued" || i.status === "uploading" || i.status === "finalizing") && i.nextAttemptAt <= now,
      );
      for (const it of due) {
        await processItem(it.localId);
      }
    } while (rerun);
  } finally {
    running = false;
    scheduleNext();
  }
}

function scheduleNext() {
  const pending = items.filter((i) => i.status === "queued");
  if (!pending.length) return;
  const next = Math.min(...pending.map((i) => i.nextAttemptAt));
  const delay = Math.max(500, next - Date.now());
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void run();
  }, delay);
}

function backoff(attempts: number) {
  return Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** Math.min(attempts, 5));
}

function current(localId: string) {
  return items.find((i) => i.localId === localId);
}

async function processItem(localId: string) {
  let it = current(localId);
  if (!it) return;
  try {
    // 1. Presign (creates the write-once media row + key).
    if (!it.mediaId || !it.uploadUrl) {
      update(localId, { status: "uploading" });
      const p = await presignMedia(it.bookingId, {
        phase: it.phase,
        slot: it.slot,
        mime: it.mime,
        bytes: it.bytes,
        sha256: it.sha256,
        geo: it.geo,
      });
      update(localId, { mediaId: p.mediaId, uploadUrl: p.uploadUrl, uploaded: false });
      it = current(localId);
      if (!it) return;
    }

    // 2. PUT the exact bytes with the exact Content-Type the presign was signed for.
    if (!it.uploaded) {
      update(localId, { status: "uploading" });
      const res = await new File(it.localUri).upload(it.uploadUrl!, {
        httpMethod: "PUT",
        uploadType: UploadType.BINARY_CONTENT,
        headers: { "Content-Type": it.mime },
      });
      if (res.status === 403 || res.status === 400) {
        // Presigned URL expired (or was signed for different headers): re-presign.
        update(localId, { mediaId: null, uploadUrl: null });
        throw new ApiError(503, `upload_rejected_${res.status}`, null);
      }
      if (res.status < 200 || res.status >= 300) {
        throw new ApiError(res.status >= 500 ? res.status : 503, `upload_http_${res.status}`, null);
      }
      update(localId, { uploaded: true });
      it = current(localId);
      if (!it) return;
    }

    // 3. Finalize: the server re-hashes and rejects on mismatch.
    update(localId, { status: "finalizing" });
    await finalizeMedia(it.bookingId, it.mediaId!);
    update(localId, { status: "verified", lastError: null });
  } catch (err) {
    const latest = current(localId);
    if (!latest) return;
    if (isTransient(err)) {
      const attempts = latest.attempts + 1;
      update(localId, {
        status: "queued",
        attempts,
        nextAttemptAt: Date.now() + backoff(attempts),
        lastError: err instanceof ApiError ? err.error : "offline",
      });
      return;
    }
    const e = err as ApiError;
    if (e.status === 404 && latest.mediaId) {
      // Media row vanished (e.g. abandoned presign was swept): start over.
      update(localId, {
        status: "queued",
        mediaId: null,
        uploadUrl: null,
        uploaded: false,
        attempts: latest.attempts + 1,
        nextAttemptAt: Date.now() + backoff(latest.attempts + 1),
        lastError: "media_missing",
      });
      return;
    }
    update(localId, {
      status: "rejected",
      lastError:
        e.status === 400 && latest.uploaded ? "Hash mismatch: the server got different bytes. Retake." : e.error,
    });
  }
}

let triggersStarted = false;
function startTriggers() {
  if (triggersStarted) return;
  triggersStarted = true;
  NetInfo.addEventListener((s) => {
    if (s.isConnected) {
      items = items.map((i) => (i.status === "queued" ? { ...i, nextAttemptAt: 0 } : i));
      kick();
    }
  });
  AppState.addEventListener("change", (s) => {
    if (s === "active") kick();
  });
}

/** Live view of the queue for one booking + phase. */
export function useUploadQueue(bookingId: string | undefined, phase: MediaPhase): QueueItem[] {
  const [all, setAll] = useState<QueueItem[]>(items);
  useEffect(() => {
    listeners.add(setAll);
    void ensureLoaded().then(() => {
      setAll(items.slice());
      kick();
    });
    return () => {
      listeners.delete(setAll);
    };
  }, []);
  return all.filter((i) => i.bookingId === bookingId && i.phase === phase);
}

/** Latest item per slot. */
export function bySlot(list: QueueItem[]): Record<string, QueueItem> {
  const out: Record<string, QueueItem> = {};
  for (const i of list) {
    if (!out[i.slot] || out[i.slot].createdAt < i.createdAt) out[i.slot] = i;
  }
  return out;
}
