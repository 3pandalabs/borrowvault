// Pure chat helpers. No React Native imports and no runtime imports: Node runs this file directly in the tests.
import type { Message } from "./types";

export const MESSAGE_MAX = 2000;
export const REPORT_MIN = 5;
export const REPORT_MAX = 500;
/** Show the composer counter once the draft gets this long. */
export const COUNTER_FROM = 1800;

/** Length in Unicode code points, which is how the API counts (an emoji is 1, not 2). */
export function codePointLength(s: string): number {
  return Array.from(s).length;
}

/** What the server will check after trimming: null = OK to send. */
export function messageProblem(draft: string): "empty" | "too_long" | null {
  const n = codePointLength(draft.trim());
  if (n === 0) return "empty";
  if (n > MESSAGE_MAX) return "too_long";
  return null;
}

export function reportReasonOk(reason: string): boolean {
  const n = codePointLength(reason.trim());
  return n >= REPORT_MIN && n <= REPORT_MAX;
}

/**
 * Append a newer page (`after=` poll, oldest first) to what we hold, in server order.
 * Ids already held are skipped, so overlapping or repeated polls are harmless.
 */
export function appendNewer(held: Message[], page: Message[]): Message[] {
  if (!page.length) return held;
  const seen = new Set(held.map((m) => m.id));
  const fresh = page.filter((m) => !seen.has(m.id));
  return fresh.length ? [...held, ...fresh] : held;
}

/** Prepend an older page (`before=`, oldest first) ahead of what we hold. */
export function prependOlder(held: Message[], page: Message[]): Message[] {
  if (!page.length) return held;
  const seen = new Set(held.map((m) => m.id));
  const fresh = page.filter((m) => !seen.has(m.id));
  return fresh.length ? [...fresh, ...held] : held;
}

/**
 * What to show: the server-confirmed list, then my just-sent messages a poll hasn't returned yet.
 * The poll cursor is always the last *confirmed* id, never a just-sent one: the other person may
 * have sent something that sits between my previous cursor and my new message.
 */
export function visibleMessages(confirmed: Message[], sentLocally: Message[]): Message[] {
  if (!sentLocally.length) return confirmed;
  const seen = new Set(confirmed.map((m) => m.id));
  const pending = sentLocally.filter((m) => !seen.has(m.id));
  return pending.length ? [...confirmed, ...pending] : confirmed;
}

/** True when `page` holds a message from someone other than me (worth marking read). */
export function hasIncoming(page: Message[], myId: string | undefined): boolean {
  return page.some((m) => m.senderId !== myId);
}

/** Tab-badge text: undefined hides the badge. */
export function badgeText(total: number): string | undefined {
  if (!total || total < 0) return undefined;
  return total > 99 ? "99+" : String(total);
}
