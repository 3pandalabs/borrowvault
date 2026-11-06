// Chat data access (api/ROUTES.md "Chat"). Routes hold the access rules and
// call these; route tests mock this module (no Postgres in the unit run).

import { and, asc, desc, eq, gt, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { trustOf, type PartyInfo } from "../booking/view.js";
import { db } from "../db/index.js";
import { bookings, conversations, listings, messageReports, messages, users } from "../db/schema.js";
import { unitLabels } from "../lib/authz.js";
import { presignDownload } from "../plugins/r2.js";
import { CONVERSATIONS_LIST_MAX, type BookingLite } from "./rules.js";

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type ReportRow = typeof messageReports.$inferSelect;
export type ListingLite = { id: string; societyId: string; ownerId: string; title: string; status: string; photoKeys: string[] };
export type BookingBetween = BookingLite & { startsAt: Date; endsAt: Date; listingId: string; borrowerId: string };
export type Side = "owner" | "borrower";

export const messageView = (m: Pick<MessageRow, "id" | "senderId" | "body" | "createdAt">) => ({
  id: m.id,
  senderId: m.senderId,
  body: m.body,
  createdAt: m.createdAt.toISOString(),
});

export async function findListing(id: string): Promise<ListingLite | null> {
  const [l] = await db
    .select({
      id: listings.id,
      societyId: listings.societyId,
      ownerId: listings.ownerId,
      title: listings.title,
      status: listings.status,
      photoKeys: listings.photoKeys,
    })
    .from(listings)
    .where(eq(listings.id, id))
    .limit(1);
  return l ?? null;
}

export async function coverUrl(l: Pick<ListingLite, "photoKeys">): Promise<string | null> {
  return l.photoKeys[0] ? presignDownload(l.photoKeys[0]) : null;
}

export async function findConversation(id: string): Promise<ConversationRow | null> {
  const [c] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return c ?? null;
}

export async function findConversationFor(listingId: string, borrowerId: string): Promise<ConversationRow | null> {
  const [c] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.listingId, listingId), eq(conversations.borrowerId, borrowerId)))
    .limit(1);
  return c ?? null;
}

/** Race-safe get-or-create on unique(listing_id, borrower_id). */
export async function getOrCreateConversation(
  l: Pick<ListingLite, "id" | "societyId" | "ownerId">,
  borrowerId: string,
): Promise<{ row: ConversationRow; created: boolean }> {
  const [ins] = await db
    .insert(conversations)
    .values({ listingId: l.id, societyId: l.societyId, ownerId: l.ownerId, borrowerId })
    .onConflictDoNothing({ target: [conversations.listingId, conversations.borrowerId] })
    .returning();
  if (ins) return { row: ins, created: true };
  const existing = await findConversationFor(l.id, borrowerId);
  if (!existing) throw new Error("conversation vanished after conflict");
  return { row: existing, created: false };
}

export async function findBooking(id: string) {
  const [b] = await db
    .select({ id: bookings.id, listingId: bookings.listingId, lenderId: bookings.lenderId, borrowerId: bookings.borrowerId })
    .from(bookings)
    .where(eq(bookings.id, id))
    .limit(1);
  return b ?? null;
}

const bookingCols = {
  id: bookings.id,
  state: bookings.state,
  stateChangedAt: bookings.stateChangedAt,
  createdAt: bookings.createdAt,
  startsAt: bookings.startsAt,
  endsAt: bookings.endsAt,
  listingId: bookings.listingId,
  borrowerId: bookings.borrowerId,
};

/** Every booking of this listing by this borrower, newest first. */
export async function bookingsBetween(listingId: string, borrowerId: string): Promise<BookingBetween[]> {
  return db
    .select(bookingCols)
    .from(bookings)
    .where(and(eq(bookings.listingId, listingId), eq(bookings.borrowerId, borrowerId)))
    .orderBy(desc(bookings.createdAt));
}

export async function partyInfos(societyId: string, userIds: string[]): Promise<Map<string, PartyInfo>> {
  const ids = [...new Set(userIds)];
  const [us, labels] = await Promise.all([
    ids.length ? db.select().from(users).where(inArray(users.id, ids)) : Promise.resolve([]),
    unitLabels(societyId, ids),
  ]);
  const out = new Map<string, PartyInfo>();
  for (const id of ids) {
    const u = us.find((x) => x.id === id);
    const l = labels.get(id);
    out.set(id, {
      id,
      displayName: u?.displayName ?? "",
      towerName: l?.towerName ?? null,
      flatNo: l?.flatNo ?? null,
      trust: u ? trustOf(u) : { score: 0, completed: 0, disputesLost: 0 },
    });
  }
  return out;
}

// Written with explicit "conversations"."col" names: Drizzle renders column
// refs unqualified in a single-table select, and inside this correlated
// subquery a bare "id" would bind to messages.id (count always 0).
const unreadExpr = (userId: string) =>
  sql<number>`(select count(*) from messages m where m.conversation_id = "conversations"."id" and m.sender_id <> ${userId} and m.seq > case when "conversations"."owner_id" = ${userId} then "conversations"."owner_last_read_seq" else "conversations"."borrower_last_read_seq" end)::int`;

export async function unreadFor(conversationId: string, userId: string): Promise<number> {
  const [r] = await db.select({ n: unreadExpr(userId) }).from(conversations).where(eq(conversations.id, conversationId));
  return Number(r?.n ?? 0);
}

/** Caller's conversations (owners don't see ones with no messages yet), newest activity first. */
export async function listMine(userId: string) {
  const activity = sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`;
  const rows = await db
    .select({ c: conversations, unread: unreadExpr(userId) })
    .from(conversations)
    .where(
      or(
        eq(conversations.borrowerId, userId),
        and(eq(conversations.ownerId, userId), isNotNull(conversations.lastMessageAt)),
      ),
    )
    .orderBy(desc(activity))
    .limit(CONVERSATIONS_LIST_MAX);
  if (!rows.length) return { rows: [], lastByConv: new Map(), listingsById: new Map(), bookings: [] as BookingBetween[] };

  const convIds = rows.map((r) => r.c.id);
  const listingIds = [...new Set(rows.map((r) => r.c.listingId))];
  const borrowerIds = [...new Set(rows.map((r) => r.c.borrowerId))];
  const [last, ls, bs] = await Promise.all([
    db
      .selectDistinctOn([messages.conversationId], {
        conversationId: messages.conversationId,
        id: messages.id,
        senderId: messages.senderId,
        body: messages.body,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(inArray(messages.conversationId, convIds))
      .orderBy(messages.conversationId, desc(messages.seq)),
    db
      .select({ id: listings.id, title: listings.title, status: listings.status, photoKeys: listings.photoKeys })
      .from(listings)
      .where(inArray(listings.id, listingIds)),
    db
      .select(bookingCols)
      .from(bookings)
      .where(and(inArray(bookings.listingId, listingIds), inArray(bookings.borrowerId, borrowerIds))),
  ]);
  return {
    rows,
    lastByConv: new Map(last.map((m) => [m.conversationId, m])),
    listingsById: new Map(ls.map((l) => [l.id, l])),
    bookings: bs as BookingBetween[],
  };
}

export async function seqOf(conversationId: string, messageId: string): Promise<number | null> {
  const [m] = await db
    .select({ seq: messages.seq })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)))
    .limit(1);
  return m?.seq ?? null;
}

/** `limit + 1` rows: oldest-first for "newer", newest-first for "older". */
export async function fetchMessages(
  conversationId: string,
  q: { afterSeq?: number; beforeSeq?: number; limit: number },
): Promise<MessageRow[]> {
  const conv = eq(messages.conversationId, conversationId);
  if (q.afterSeq !== undefined) {
    return db
      .select()
      .from(messages)
      .where(and(conv, gt(messages.seq, q.afterSeq)))
      .orderBy(asc(messages.seq))
      .limit(q.limit + 1);
  }
  return db
    .select()
    .from(messages)
    .where(q.beforeSeq !== undefined ? and(conv, lt(messages.seq, q.beforeSeq)) : conv)
    .orderBy(desc(messages.seq))
    .limit(q.limit + 1);
}

/**
 * Locks the conversation row first so that, within a conversation, seq order
 * equals commit order (pollers using `after=` can't skip a message). The
 * sender's own message counts as read.
 */
export async function insertMessage(conversationId: string, senderId: string, side: Side, body: string): Promise<MessageRow> {
  return db.transaction(async (tx) => {
    await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversationId)).for("update");
    const [m] = await tx.insert(messages).values({ conversationId, senderId, body }).returning();
    await tx
      .update(conversations)
      .set(
        side === "owner"
          ? { lastMessageAt: m.createdAt, ownerLastReadSeq: sql`greatest(${conversations.ownerLastReadSeq}, ${m.seq})` }
          : { lastMessageAt: m.createdAt, borrowerLastReadSeq: sql`greatest(${conversations.borrowerLastReadSeq}, ${m.seq})` },
      )
      .where(eq(conversations.id, conversationId));
    return m;
  });
}

/** Moves the side's read marker forward (never back). `seq` null = up to the latest message. */
export async function markRead(conversationId: string, side: Side, seq: number | null): Promise<void> {
  const target =
    seq ?? sql`coalesce((select max(m.seq) from messages m where m.conversation_id = ${conversationId}), 0)`;
  const col = side === "owner" ? conversations.ownerLastReadSeq : conversations.borrowerLastReadSeq;
  await db
    .update(conversations)
    .set(side === "owner" ? { ownerLastReadSeq: sql`greatest(${col}, ${target})` } : { borrowerLastReadSeq: sql`greatest(${col}, ${target})` })
    .where(eq(conversations.id, conversationId));
}

/** Non-zero unread counts per conversation for this user. */
export async function unreadCounts(userId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ id: conversations.id, n: unreadExpr(userId) })
    .from(conversations)
    .where(or(eq(conversations.ownerId, userId), eq(conversations.borrowerId, userId)));
  const out: Record<string, number> = {};
  for (const r of rows) if (Number(r.n) > 0) out[r.id] = Number(r.n);
  return out;
}

export async function findMessage(id: string): Promise<{ m: MessageRow; c: ConversationRow } | null> {
  const [r] = await db
    .select({ m: messages, c: conversations })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(eq(messages.id, id))
    .limit(1);
  return r ?? null;
}

/** null when this reporter already reported this message. */
export async function insertReport(m: MessageRow, c: ConversationRow, reporterId: string, reason: string): Promise<ReportRow | null> {
  const [r] = await db
    .insert(messageReports)
    .values({ messageId: m.id, conversationId: c.id, societyId: c.societyId, reporterId, reason })
    .onConflictDoNothing({ target: [messageReports.messageId, messageReports.reporterId] })
    .returning();
  return r ?? null;
}

export async function listReports(societyId: string, status: "open" | "reviewed", limit = 100) {
  return db
    .select({ r: messageReports, c: conversations })
    .from(messageReports)
    .innerJoin(conversations, eq(conversations.id, messageReports.conversationId))
    .where(and(eq(messageReports.societyId, societyId), eq(messageReports.status, status)))
    .orderBy(desc(messageReports.createdAt))
    .limit(limit);
}

export async function findReport(id: string) {
  const [r] = await db
    .select({ r: messageReports, c: conversations })
    .from(messageReports)
    .innerJoin(conversations, eq(conversations.id, messageReports.conversationId))
    .where(eq(messageReports.id, id))
    .limit(1);
  return r ?? null;
}

/** Marks an open report reviewed; returns the (possibly already reviewed) row. */
export async function reviewReport(id: string, reviewerId: string, note: string | null): Promise<ReportRow> {
  const [u] = await db
    .update(messageReports)
    .set({ status: "reviewed", reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: note })
    .where(and(eq(messageReports.id, id), eq(messageReports.status, "open")))
    .returning();
  if (u) return u;
  const [r] = await db.select().from(messageReports).where(eq(messageReports.id, id)).limit(1);
  return r;
}

/** The reported message with up to `around` messages either side, oldest first. */
export async function reportContext(m: MessageRow, around = 5): Promise<MessageRow[]> {
  const conv = eq(messages.conversationId, m.conversationId);
  const [before, after] = await Promise.all([
    db.select().from(messages).where(and(conv, lt(messages.seq, m.seq))).orderBy(desc(messages.seq)).limit(around),
    db.select().from(messages).where(and(conv, gt(messages.seq, m.seq))).orderBy(asc(messages.seq)).limit(around),
  ]);
  return [...before.reverse(), m, ...after];
}

export async function findMessagesByIds(ids: string[]): Promise<MessageRow[]> {
  return ids.length ? db.select().from(messages).where(inArray(messages.id, ids)) : [];
}

export async function userNames(ids: string[]): Promise<Map<string, string>> {
  const u = [...new Set(ids)];
  const rows = u.length ? await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, u)) : [];
  return new Map(rows.map((r) => [r.id, r.n]));
}
