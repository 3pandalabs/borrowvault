import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../db/index.js";
import { memberships, societies } from "../db/schema.js";
import { notFound } from "./errors.js";

// DB side of the pilot rules (lib/pilot.ts holds the pure checks).

export async function societyTierOf(societyId: string, q: DbOrTx = db): Promise<string> {
  const [s] = await q.select({ tier: societies.tier }).from(societies).where(eq(societies.id, societyId)).limit(1);
  if (!s) throw notFound();
  return s.tier;
}

export async function approvedMemberCount(societyId: string, q: DbOrTx = db): Promise<number> {
  const [r] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.societyId, societyId), eq(memberships.status, "approved")));
  return Number(r?.n ?? 0);
}

/**
 * Locks the society row for the rest of the transaction and returns its tier.
 * Serialises membership approvals so two can't both take a pilot's last place.
 */
export async function lockSocietyTier(tx: DbOrTx, societyId: string): Promise<string> {
  const [s] = await tx.select({ tier: societies.tier }).from(societies).where(eq(societies.id, societyId)).for("update");
  if (!s) throw notFound();
  return s.tier;
}

/** `memberCount` subquery for Society views: approved memberships, admins included. */
export const memberCountSql = sql<number>`(select count(*) from ${memberships} where ${memberships.societyId} = ${societies.id} and ${memberships.status} = 'approved')::int`;
