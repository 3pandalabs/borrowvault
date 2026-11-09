import { and, desc, eq, inArray, isNull, or, sql, type AnyColumn } from "drizzle-orm";
import { db, type DbOrTx } from "../db/index.js";
import { bookings, conversations, memberships, userBlocks, users } from "../db/schema.js";

// User blocking (api/ROUTES.md "Users: blocking and reporting"). A block in
// EITHER direction stops chat sends, new conversations, new bookings and
// browse visibility between the two. Existing bookings carry on.

export type BlockedUserView = { user: { id: string; displayName: string }; createdAt: string };

/** True when a blocked b or b blocked a. */
export async function blockedEitherWay(a: string, b: string, q: DbOrTx = db): Promise<boolean> {
  if (a === b) return false;
  const rows = await q
    .select({ x: userBlocks.blockerId })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)),
        and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Everyone the user blocked or was blocked by. */
export async function blockedIdsFor(userId: string, q: DbOrTx = db): Promise<Set<string>> {
  const rows = await q
    .select({ blockerId: userBlocks.blockerId, blockedId: userBlocks.blockedId })
    .from(userBlocks)
    .where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)));
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
}

/** Did `blockerId` block `blockedId` (one direction)? */
export async function hasBlocked(blockerId: string, blockedId: string, q: DbOrTx = db): Promise<boolean> {
  const rows = await q
    .select({ x: userBlocks.blockerId })
    .from(userBlocks)
    .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Societies that relate `me` to `other`, best first: societies where both have
 * an approved membership, then the societies of their conversations/bookings
 * (newest first). Empty = unrelated (or `other` is unknown/deleted): callers 404.
 */
export async function relatedSocieties(me: string, other: string, q: DbOrTx = db): Promise<string[]> {
  if (me === other) return [];
  const [u] = await q
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, other), isNull(users.deletedAt)))
    .limit(1);
  if (!u) return [];
  const ms = await q
    .select({ userId: memberships.userId, societyId: memberships.societyId })
    .from(memberships)
    .where(and(inArray(memberships.userId, [me, other]), eq(memberships.status, "approved")));
  const mine = new Set(ms.filter((m) => m.userId === me).map((m) => m.societyId));
  const shared = [...new Set(ms.filter((m) => m.userId === other && mine.has(m.societyId)).map((m) => m.societyId))];
  const pair = (a: typeof conversations.ownerId | typeof bookings.lenderId, b: typeof conversations.borrowerId | typeof bookings.borrowerId) =>
    or(and(eq(a, me), eq(b, other)), and(eq(a, other), eq(b, me)));
  const convs = await q
    .select({ societyId: conversations.societyId, at: conversations.createdAt })
    .from(conversations)
    .where(pair(conversations.ownerId, conversations.borrowerId))
    .orderBy(desc(conversations.createdAt))
    .limit(20);
  const bks = await q
    .select({ societyId: bookings.societyId, at: bookings.createdAt })
    .from(bookings)
    .where(pair(bookings.lenderId, bookings.borrowerId))
    .orderBy(desc(bookings.createdAt))
    .limit(20);
  const viaHistory = [...convs, ...bks].sort((x, y) => y.at.getTime() - x.at.getTime()).map((r) => r.societyId);
  return [...new Set([...shared, ...viaHistory])];
}

export async function block(blockerId: string, blockedId: string): Promise<{ row: BlockedUserView; created: boolean }> {
  const [ins] = await db
    .insert(userBlocks)
    .values({ blockerId, blockedId })
    .onConflictDoNothing()
    .returning({ createdAt: userBlocks.createdAt });
  const [existing] = ins
    ? [ins]
    : await db
        .select({ createdAt: userBlocks.createdAt })
        .from(userBlocks)
        .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)))
        .limit(1);
  const [u] = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, blockedId)).limit(1);
  return {
    row: { user: { id: blockedId, displayName: u?.displayName ?? "" }, createdAt: (existing?.createdAt ?? new Date()).toISOString() },
    created: Boolean(ins),
  };
}

export async function unblock(blockerId: string, blockedId: string): Promise<void> {
  await db.delete(userBlocks).where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)));
}

export async function listBlocks(blockerId: string): Promise<BlockedUserView[]> {
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, createdAt: userBlocks.createdAt })
    .from(userBlocks)
    .innerJoin(users, eq(users.id, userBlocks.blockedId))
    .where(eq(userBlocks.blockerId, blockerId))
    .orderBy(desc(userBlocks.createdAt));
  return rows.map((r) => ({ user: { id: r.id, displayName: r.displayName }, createdAt: r.createdAt.toISOString() }));
}

/** SQL predicate: `ownerCol` is not blocked by / blocking `me` (for browse queries). */
export function notBlockedWith(me: string, ownerCol: AnyColumn) {
  return sql`not exists (select 1 from ${userBlocks} ub where (ub.blocker_id = ${me} and ub.blocked_id = ${ownerCol}) or (ub.blocked_id = ${me} and ub.blocker_id = ${ownerCol}))`;
}
