import { and, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "../db/index.js";
import { memberships, towers, units, users } from "../db/schema.js";
import { forbidden, notFound } from "./errors.js";

// Society scoping. Rule (CLAUDE.md): anything outside the caller's APPROVED
// societies is a 404, never a 403, so existence never leaks. 403 is only for
// "you're in the society but this isn't yours / you lack the role".

export async function isPlatformAdmin(userId: string, q: DbOrTx = db): Promise<boolean> {
  const [u] = await q.select({ a: users.isPlatformAdmin }).from(users).where(eq(users.id, userId)).limit(1);
  return Boolean(u?.a);
}

export async function approvedSocietyIds(userId: string, q: DbOrTx = db): Promise<string[]> {
  const rows = await q
    .select({ societyId: memberships.societyId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "approved")));
  return rows.map((r) => r.societyId);
}

export async function approvedMembership(userId: string, societyId: string, q: DbOrTx = db) {
  const [m] = await q
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.societyId, societyId), eq(memberships.status, "approved")),
    )
    .limit(1);
  return m ?? null;
}

/** Throws 404 unless the user is an approved member of the society. */
export async function requireApprovedMember(userId: string, societyId: string, q: DbOrTx = db) {
  const m = await approvedMembership(userId, societyId, q);
  if (!m) throw notFound();
  return m;
}

export async function isSocietyAdmin(userId: string, societyId: string, q: DbOrTx = db): Promise<boolean> {
  const m = await approvedMembership(userId, societyId, q);
  if (m?.role === "society_admin") return true;
  return isPlatformAdmin(userId, q);
}

/** Society admin (or platform admin). Non-members get 404, plain residents 403. */
export async function requireSocietyAdmin(userId: string, societyId: string, q: DbOrTx = db): Promise<void> {
  const m = await approvedMembership(userId, societyId, q);
  if (m?.role === "society_admin") return;
  if (await isPlatformAdmin(userId, q)) return;
  if (m) throw forbidden("society_admin_required");
  throw notFound();
}

/**
 * Arbiter rule: an arbiter may not live in either party's unit. Any
 * non-rejected membership of the arbiter in this society counts as "lives in".
 */
export async function sharesUnitWithParty(
  arbiterId: string,
  b: { societyId: string; lenderId: string; borrowerId: string },
  q: DbOrTx = db,
): Promise<boolean> {
  const rows = await q
    .select({ userId: memberships.userId, unitId: memberships.unitId, status: memberships.status })
    .from(memberships)
    .where(
      and(
        eq(memberships.societyId, b.societyId),
        inArray(memberships.userId, [arbiterId, b.lenderId, b.borrowerId]),
      ),
    );
  const live = rows.filter((r) => r.unitId && r.status !== "rejected");
  const arbiterUnits = new Set(live.filter((r) => r.userId === arbiterId).map((r) => r.unitId));
  return live.some((r) => r.userId !== arbiterId && arbiterUnits.has(r.unitId));
}

/** Throws 403 unless the user may arbitrate disputes on this booking. */
export async function assertArbiter(
  arbiterId: string,
  b: { societyId: string; lenderId: string; borrowerId: string },
  q: DbOrTx = db,
): Promise<void> {
  if (arbiterId === b.lenderId || arbiterId === b.borrowerId) throw forbidden("parties cannot arbitrate");
  if (!(await isSocietyAdmin(arbiterId, b.societyId, q))) throw forbidden("not an arbiter for this society");
  if (await sharesUnitWithParty(arbiterId, b, q)) throw forbidden("arbiter lives in a party's unit");
}

/** "Tower A / 1203" for each user in a society (approved or not). */
export async function unitLabels(
  societyId: string,
  userIds: string[],
  q: DbOrTx = db,
): Promise<Map<string, { towerName: string | null; flatNo: string | null }>> {
  const out = new Map<string, { towerName: string | null; flatNo: string | null }>();
  if (userIds.length === 0) return out;
  const rows = await q
    .select({ userId: memberships.userId, towerName: towers.name, flatNo: units.flatNo })
    .from(memberships)
    .leftJoin(units, eq(units.id, memberships.unitId))
    .leftJoin(towers, eq(towers.id, units.towerId))
    .where(and(eq(memberships.societyId, societyId), inArray(memberships.userId, userIds)));
  for (const r of rows) out.set(r.userId, { towerName: r.towerName, flatNo: r.flatNo });
  return out;
}
