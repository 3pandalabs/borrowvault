// Pure chat rules (api/ROUTES.md "Chat"). No DB/env imports so unit tests can
// load them directly.

import { z } from "zod";
import type { BookingState } from "../booking/states.js";

export const MESSAGE_MAX_CHARS = 2000;
export const PREVIEW_MAX_CHARS = 140;
export const MESSAGES_PAGE_DEFAULT = 50;
export const MESSAGES_PAGE_MAX = 100;
export const CONVERSATIONS_LIST_MAX = 100;
/** How long after a booking's last state change the pair may keep chatting about it. */
export const RECENT_BOOKING_GRACE_MS = 7 * 24 * 3_600_000;

/** Bookings that keep a conversation writable whatever the listing/membership status. */
export const LIVE_BOOKING_STATES: readonly BookingState[] = [
  "REQUESTED",
  "ACCEPTED",
  "DEPOSIT_HELD",
  "HANDOVER_PENDING",
  "ACTIVE",
  "OVERDUE",
  "RETURN_PENDING",
  "DISPUTED",
];

/** Bookings that let eligible admins read the conversation (read-only). */
export const ADMIN_READABLE_STATES: readonly BookingState[] = ["DISPUTED", "RESOLVED"];

const codePoints = (s: string) => [...s].length;

/** Message body: trimmed, 1–2000 characters (Unicode code points, same as Postgres char_length). */
export const messageBody = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => codePoints(s) >= 1, { message: "message_empty" })
  .refine((s) => codePoints(s) <= MESSAGE_MAX_CHARS, { message: "message_too_long" });

export const reportReason = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => codePoints(s) >= 5 && codePoints(s) <= 500, { message: "reason must be 5-500 characters" });

export function preview(body: string): string {
  const cps = [...body];
  return cps.length <= PREVIEW_MAX_CHARS ? body : `${cps.slice(0, PREVIEW_MAX_CHARS - 1).join("")}…`;
}

export type BookingLite = { id: string; state: BookingState; stateChangedAt: Date; createdAt: Date };

/** A booking that keeps the chat open: live, or changed state within the grace window. */
export function keepsChatOpen(b: BookingLite, now: number): boolean {
  return LIVE_BOOKING_STATES.includes(b.state) || now - b.stateChangedAt.getTime() <= RECENT_BOOKING_GRACE_MS;
}

/**
 * Who may send. Never while either participant has blocked the other.
 * Otherwise either a booking between the two keeps the chat open, or the
 * listing isn't archived/removed AND the sender is (still) an approved member
 * of the society. Admin viewers never send.
 */
export function canSend(i: {
  role: "owner" | "borrower" | "admin";
  listingStatus: string;
  senderApprovedMember: boolean;
  bookings: BookingLite[];
  now: number;
  blocked?: boolean;
}): boolean {
  if (i.role === "admin" || i.blocked) return false;
  if (i.bookings.some((b) => keepsChatOpen(b, i.now))) return true;
  return i.listingStatus !== "archived" && i.listingStatus !== "removed" && i.senderApprovedMember;
}

/** Newest live booking (the one a chat header links to), or null. */
export function activeBookingId(bookings: BookingLite[]): string | null {
  const live = bookings
    .filter((b) => LIVE_BOOKING_STATES.includes(b.state))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return live[0]?.id ?? null;
}

export function adminReadable(bookings: { state: BookingState }[]): boolean {
  return bookings.some((b) => ADMIN_READABLE_STATES.includes(b.state));
}

/** Messages page from `limit + 1` rows already in the query's own order. */
export function pageOf<T extends { seq: number }>(
  rows: T[],
  limit: number,
  direction: "newer" | "older",
): { rows: T[]; hasMore: boolean } {
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  // "older" queries run newest-first; responses are always oldest-first.
  if (direction === "older") page.reverse();
  return { rows: page, hasMore };
}
