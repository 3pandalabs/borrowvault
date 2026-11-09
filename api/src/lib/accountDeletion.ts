import { and, eq, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../db/index.js";
import {
  adminRequests,
  bookingPayments,
  bookings,
  listings,
  memberships,
  passwordResetTokens,
  pushTokens,
  sessions,
  userBlocks,
  users,
} from "../db/schema.js";
import { deleteObjectQuietly } from "../plugins/r2.js";
import { deletionBlockers, type DeletionBlocker } from "./deletionRules.js";

// Account deletion (api/ROUTES.md "Account deletion"). The user row is kept and
// anonymised because bookings, disputes, ratings and immutable chat messages
// point at it; everything personal that isn't a shared record goes.

export type { DeletionBlocker } from "./deletionRules.js";

/** Bookings (either side) with what deletionBlockers needs to classify them. */
export async function blockersFor(userId: string, q: DbOrTx = db): Promise<DeletionBlocker[]> {
  const rows = await q
    .select({
      bookingId: bookings.id,
      state: bookings.state,
      listingTitle: listings.title,
      awardStatus: bookingPayments.awardStatus,
      awardPayerId: bookingPayments.awardPayerId,
      awardPayeeId: bookingPayments.awardPayeeId,
      refundDuePaise: bookingPayments.refundDuePaise,
      refundConfirmedAt: bookingPayments.refundConfirmedAt,
    })
    .from(bookings)
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .leftJoin(bookingPayments, eq(bookingPayments.bookingId, bookings.id))
    .where(
      and(
        or(eq(bookings.lenderId, userId), eq(bookings.borrowerId, userId)),
        // DECLINED/EXPIRED never carry money; skip them early.
        notInArray(bookings.state, ["DECLINED", "EXPIRED"]),
      ),
    );
  return deletionBlockers(rows, userId);
}

export const DELETED_DISPLAY_NAME = "Deleted user";
/** Not a bcrypt hash, so bcrypt.compare is always false. */
export const UNUSABLE_PASSWORD_HASH = "!deleted";

export function tombstoneEmail(userId: string): string {
  return `deleted+${userId}@deleted.invalid`;
}

/** The anonymised user row (pure, unit-tested). */
export function anonymisedUser(userId: string, now: Date) {
  return {
    email: tombstoneEmail(userId),
    displayName: DELETED_DISPLAY_NAME,
    phone: "",
    upiVpa: null,
    passwordHash: UNUSABLE_PASSWORD_HASH,
    chatPushEnabled: false,
    isPlatformAdmin: false,
    deletedAt: now,
  };
}

export type DeletionResult =
  | { ok: true; purgedKeys: string[] }
  | { ok: false; reason: "already_deleted" }
  | { ok: false; reason: "blocked"; blockers: DeletionBlocker[] };

/**
 * One transaction: lock the user, re-check blockers, anonymise, archive
 * listings, revoke memberships, close admin requests, drop credentials and
 * blocks. Returns the R2 keys to delete after the commit.
 */
export async function deleteAccount(userId: string, now = new Date()): Promise<DeletionResult> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`select id, deleted_at from users where id = ${userId} for update`);
    const u = locked.rows[0] as { id: string; deleted_at: Date | null } | undefined;
    if (!u || u.deleted_at) return { ok: false, reason: "already_deleted" } as const;

    const blockers = await blockersFor(userId, tx);
    if (blockers.length) return { ok: false, reason: "blocked", blockers } as const;

    const keys: string[] = [];

    // Listings: archive the live ones, drop every photo.
    const ls = await tx.select({ id: listings.id, photoKeys: listings.photoKeys }).from(listings).where(eq(listings.ownerId, userId));
    for (const l of ls) keys.push(...l.photoKeys);
    await tx
      .update(listings)
      .set({ status: sql`case when ${listings.status} in ('archived', 'removed') then ${listings.status} else 'archived' end`, photoKeys: [], updatedAt: now })
      .where(eq(listings.ownerId, userId));

    // Memberships: revoke, demote, drop the proof file.
    const ms = await tx.select({ proofKey: memberships.proofKey }).from(memberships).where(eq(memberships.userId, userId));
    for (const m of ms) if (m.proofKey) keys.push(m.proofKey);
    await tx
      .update(memberships)
      .set({ status: "revoked", role: "resident", adminSince: null })
      .where(and(eq(memberships.userId, userId), inArray(memberships.status, ["pending", "approved"])));
    await tx.update(memberships).set({ proofKey: null }).where(eq(memberships.userId, userId));

    // Admin requests: close their open ones and nominations they made; purge documents.
    const ars = await tx
      .select({
        idProofKey: adminRequests.idProofKey,
        residenceProofKey: adminRequests.residenceProofKey,
        rwaRegistrationKey: adminRequests.rwaRegistrationKey,
        authorizationKey: adminRequests.authorizationKey,
      })
      .from(adminRequests)
      .where(eq(adminRequests.requesterId, userId));
    for (const a of ars) for (const k of [a.idProofKey, a.residenceProofKey, a.rwaRegistrationKey, a.authorizationKey]) if (k) keys.push(k);
    await tx
      .update(adminRequests)
      .set({ status: "withdrawn", updatedAt: now })
      .where(and(eq(adminRequests.requesterId, userId), eq(adminRequests.status, "pending")));
    await tx
      .update(adminRequests)
      .set({ status: "declined", updatedAt: now })
      .where(and(eq(adminRequests.requesterId, userId), eq(adminRequests.status, "nominated")));
    await tx
      .update(adminRequests)
      .set({ status: "cancelled", updatedAt: now })
      .where(
        and(
          eq(adminRequests.nominatedBy, userId),
          ne(adminRequests.requesterId, userId),
          inArray(adminRequests.status, ["nominated", "pending"]),
        ),
      );
    await tx
      .update(adminRequests)
      .set({ idProofKey: null, residenceProofKey: null, rwaRegistrationKey: null, authorizationKey: null, docsPurgedAt: now })
      .where(and(eq(adminRequests.requesterId, userId), isNull(adminRequests.docsPurgedAt)));

    // Credentials and personal lists.
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
    await tx.delete(pushTokens).where(eq(pushTokens.userId, userId));
    await tx.delete(userBlocks).where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)));

    await tx.update(users).set(anonymisedUser(userId, now)).where(eq(users.id, userId));
    return { ok: true, purgedKeys: [...new Set(keys)] } as const;
  });
}

/** After the commit: best effort; the keys are already unreachable from the DB. */
export async function purgeObjects(keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => deleteObjectQuietly(k)));
}
