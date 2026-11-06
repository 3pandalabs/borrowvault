// Expo push sender (api/ROUTES.md "Push notifications"). Best effort:
// sendPush never throws, every failure is logged and dropped. Callers still
// run it fire-and-forget so a slow push service never holds up a request.
//
// Receipts are NOT polled (Phase 1): only ticket-level DeviceNotRegistered
// errors prune tokens.

import { env } from "../env.js";
import { deleteTokens } from "./pushTokens.js";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const PUSH_BATCH_MAX = 100;
export const PUSH_TIMEOUT_MS = 5_000;

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound?: "default";
  priority?: "default" | "normal" | "high";
  channelId?: string;
};

type Ticket = { status: "ok"; id: string } | { status: "error"; message?: string; details?: { error?: string } };

const log = (msg: string) => console.log(`[push] ${msg}`);

async function sendBatch(batch: PushMessage[]): Promise<void> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  if (env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(batch),
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });
  if (!res.ok) {
    log(`push service answered ${res.status}`);
    return;
  }
  const json = (await res.json()) as { data?: Ticket[] };
  const tickets = Array.isArray(json.data) ? json.data : [];
  // Tickets come back in the order of the messages sent.
  const dead: string[] = [];
  tickets.forEach((t, i) => {
    if (t.status !== "error") return;
    if (t.details?.error === "DeviceNotRegistered" && batch[i]) dead.push(batch[i].to);
    else log(`ticket error: ${t.details?.error ?? t.message ?? "unknown"}`);
  });
  if (dead.length) {
    await deleteTokens(dead);
    log(`removed ${dead.length} unregistered token(s)`);
  }
}

/** Sends in batches of ≤100. Never throws. */
export async function sendPush(messages: PushMessage[]): Promise<void> {
  for (let i = 0; i < messages.length; i += PUSH_BATCH_MAX) {
    try {
      await sendBatch(messages.slice(i, i + PUSH_BATCH_MAX));
    } catch (err) {
      log(`send failed: ${String(err)}`);
    }
  }
}
