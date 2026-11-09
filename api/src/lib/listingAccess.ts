import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { listings, memberships } from "../db/schema.js";
import { approvedMembership, requireApprovedMember } from "./authz.js";
import { blockedEitherWay } from "./blocks.js";
import { notFound } from "./errors.js";

// Who may see a listing (api/ROUTES.md "Listings"). Shared by the listing
// routes and listing reports.

export type ListingRow = typeof listings.$inferSelect;

/** Statuses only the owner can see. */
export const HIDDEN_STATUSES = ["archived", "removed"];

/**
 * Owner always. Everyone else: approved member of its society, listing not
 * archived/removed, owner still an approved member there, no block either way.
 * 404 otherwise (never leak existence).
 */
export async function visibleListing(id: string, userId: string): Promise<ListingRow> {
  const [l] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
  if (!l) throw notFound();
  if (l.ownerId === userId) return l;
  await requireApprovedMember(userId, l.societyId);
  if (HIDDEN_STATUSES.includes(l.status)) throw notFound();
  if (!(await approvedMembership(l.ownerId, l.societyId))) throw notFound();
  if (await blockedEitherWay(userId, l.ownerId)) throw notFound();
  return l;
}

/** SQL predicate for browse: the listing's owner is an approved member of the listing's society. */
export const ownerStillMember = sql`exists (select 1 from ${memberships} m where m.user_id = ${listings.ownerId} and m.society_id = ${listings.societyId} and m.status = 'approved')`;

