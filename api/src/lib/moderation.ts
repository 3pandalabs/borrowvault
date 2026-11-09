import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { listingReports, listings, userReports } from "../db/schema.js";

// User and listing reports + admin takedown (api/ROUTES.md "Users: blocking
// and reporting", "Admin takedown", "Reports review"). Data access only; the
// routes hold the access rules. Route tests mock this module.

export type UserReportRow = typeof userReports.$inferSelect;
export type ListingReportRow = typeof listingReports.$inferSelect;
type ListingRow = typeof listings.$inferSelect;

/** Optional free text on a report: trimmed, ≤1000, empty → undefined. */
export const reportDetails = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((s) => (s ? s : undefined));

export const USER_REPORT_OPEN = ["open"] as const;
export const USER_REPORT_CLOSED = ["reviewed", "dismissed"] as const;
export const LISTING_REPORT_CLOSED = ["dismissed", "actioned"] as const;

/** null = the reporter already has an open report on this listing. */
export async function insertListingReport(v: {
  listingId: string;
  societyId: string;
  reporterId: string;
  reason: ListingReportRow["reason"];
  details: string | null;
}): Promise<ListingReportRow | null> {
  const [r] = await db.insert(listingReports).values(v).onConflictDoNothing().returning();
  return r ?? null;
}

/** null = the reporter already has an open report on this user. */
export async function insertUserReport(v: {
  reporterId: string;
  reportedId: string;
  societyId: string;
  reason: UserReportRow["reason"];
  details: string | null;
}): Promise<UserReportRow | null> {
  const [r] = await db.insert(userReports).values(v).onConflictDoNothing().returning();
  return r ?? null;
}

/** Takedown: status removed + note, and the listing's open reports become actioned. One transaction. */
export async function removeListing(listingId: string, adminId: string, note: string): Promise<ListingRow> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(listings)
      .set({ status: "removed", removedBy: adminId, removedAt: now, removalNote: note, updatedAt: now })
      .where(eq(listings.id, listingId))
      .returning();
    await tx
      .update(listingReports)
      .set({ status: "actioned", reviewedBy: adminId, reviewedAt: now, reviewNote: note })
      .where(and(eq(listingReports.listingId, listingId), eq(listingReports.status, "open")));
    return row;
  });
}

export async function listUserReports(societyId: string, status: "open" | "closed", limit = 100): Promise<UserReportRow[]> {
  return db
    .select()
    .from(userReports)
    .where(
      and(
        eq(userReports.societyId, societyId),
        inArray(userReports.status, status === "open" ? [...USER_REPORT_OPEN] : [...USER_REPORT_CLOSED]),
      ),
    )
    .orderBy(desc(userReports.createdAt))
    .limit(limit);
}

export async function findUserReport(id: string): Promise<UserReportRow | null> {
  const [r] = await db.select().from(userReports).where(eq(userReports.id, id)).limit(1);
  return r ?? null;
}

export async function reviewUserReport(
  id: string,
  reviewerId: string,
  decision: "reviewed" | "dismissed",
  note: string | null,
): Promise<UserReportRow> {
  const [r] = await db
    .update(userReports)
    .set({ status: decision, reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: note })
    .where(and(eq(userReports.id, id), eq(userReports.status, "open")))
    .returning();
  return r ?? (await findUserReport(id))!;
}

export async function listListingReports(
  societyId: string,
  status: "open" | "closed",
  limit = 100,
): Promise<{ r: ListingReportRow; l: ListingRow }[]> {
  return db
    .select({ r: listingReports, l: listings })
    .from(listingReports)
    .innerJoin(listings, eq(listings.id, listingReports.listingId))
    .where(
      and(
        eq(listingReports.societyId, societyId),
        status === "open" ? eq(listingReports.status, "open") : inArray(listingReports.status, [...LISTING_REPORT_CLOSED]),
      ),
    )
    .orderBy(desc(listingReports.createdAt))
    .limit(limit);
}

export async function findListingReport(id: string): Promise<{ r: ListingReportRow; l: ListingRow } | null> {
  const [row] = await db
    .select({ r: listingReports, l: listings })
    .from(listingReports)
    .innerJoin(listings, eq(listings.id, listingReports.listingId))
    .where(eq(listingReports.id, id))
    .limit(1);
  return row ?? null;
}

export async function dismissListingReport(id: string, reviewerId: string, note: string | null): Promise<void> {
  await db
    .update(listingReports)
    .set({ status: "dismissed", reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: note })
    .where(and(eq(listingReports.id, id), eq(listingReports.status, "open")));
}
