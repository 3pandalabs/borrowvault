// Chat push notifications (api/ROUTES.md "Chat" → "Push notifications").
// Called fire-and-forget after a message is stored; never throws.

import { chatPushTargets } from "../lib/pushTokens.js";
import { sendPush, type PushMessage } from "../lib/push.js";
import * as store from "./store.js";

export const PUSH_THROTTLE_MS = 60_000;
export const PUSH_PREVIEW_MAX_CHARS = 100;

/**
 * Last push per (conversation, recipient): when, and the pushed message's seq.
 * IN MEMORY, PER PROCESS: borrowvault-api is one container, and a restart only
 * forgets the throttle (at worst one extra push).
 */
const lastPush = new Map<string, { at: number; seq: number }>();
const SWEEP_AT = 500;

/** Test hook. */
export function resetPushThrottle(): void {
  lastPush.clear();
}

export function pushPreview(body: string): string {
  const cps = [...body.replace(/\s+/g, " ").trim()];
  return cps.length <= PUSH_PREVIEW_MAX_CHARS ? cps.join("") : `${cps.slice(0, PUSH_PREVIEW_MAX_CHARS - 1).join("")}…`;
}

/**
 * Throttle rule: one push per 60 s per (conversation, recipient), unless the
 * recipient has read up to (or past) the previously pushed message. Check and
 * record happen synchronously together, so two concurrent sends can't both pass.
 */
export function claimPushSlot(key: string, seq: number, recipientReadSeq: number, now: number): boolean {
  const prev = lastPush.get(key);
  if (prev && now - prev.at < PUSH_THROTTLE_MS && recipientReadSeq < prev.seq) return false;
  if (lastPush.size >= SWEEP_AT) {
    for (const [k, v] of lastPush) if (now - v.at >= PUSH_THROTTLE_MS) lastPush.delete(k);
  }
  lastPush.set(key, { at: now, seq });
  return true;
}

export function chatPushMessages(
  tokens: string[],
  p: { senderName: string; listingTitle: string; body: string; conversationId: string },
): PushMessage[] {
  const preview = pushPreview(p.body);
  const body = p.listingTitle ? `${p.listingTitle}: ${preview}` : preview;
  return tokens.map((to) => ({
    to,
    title: p.senderName || "New message",
    body,
    data: { type: "chat", conversationId: p.conversationId },
    sound: "default",
    priority: "high",
    channelId: "chat",
  }));
}

/** Notifies the other participant of `m`. Admins are never participants, so never notified. */
export async function notifyNewMessage(
  c: Pick<store.ConversationRow, "id" | "listingId" | "ownerId" | "borrowerId">,
  m: Pick<store.MessageRow, "senderId" | "seq" | "body">,
): Promise<void> {
  try {
    const recipientIsOwner = m.senderId !== c.ownerId;
    const recipientId = recipientIsOwner ? c.ownerId : c.borrowerId;
    if (recipientId === m.senderId) return;
    const [tokens, fresh] = await Promise.all([chatPushTargets(recipientId), store.findConversation(c.id)]);
    if (!tokens.length || !fresh) return; // push turned off, or no devices
    const readSeq = recipientIsOwner ? fresh.ownerLastReadSeq : fresh.borrowerLastReadSeq;
    if (!claimPushSlot(`${c.id}:${recipientId}`, m.seq, readSeq, Date.now())) return;
    const [names, listing] = await Promise.all([store.userNames([m.senderId]), store.findListing(c.listingId)]);
    await sendPush(
      chatPushMessages(tokens, {
        senderName: names.get(m.senderId) ?? "",
        listingTitle: listing?.title ?? "",
        body: m.body,
        conversationId: c.id,
      }),
    );
  } catch (err) {
    console.log(`[push] chat notify failed: ${String(err)}`);
  }
}
