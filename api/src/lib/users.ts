import { desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { memberships, societies, towers, units, users } from "../db/schema.js";

type UserRow = typeof users.$inferSelect;

/** `user` shape from api/ROUTES.md. Never includes the password hash. */
export function userView(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    phone: u.phone,
    upiVpa: u.upiVpa,
    isPlatformAdmin: u.isPlatformAdmin,
    trust: { score: u.trustScore, completed: u.trustCompleted, disputesLost: u.trustDisputesLost },
  };
}

export type MembershipView = {
  id: string;
  societyId: string;
  societyName: string;
  towerName: string | null;
  flatNo: string | null;
  role: "resident" | "society_admin";
  status: "pending" | "approved" | "rejected" | "revoked";
  occupancy: string;
  createdAt: string;
};

export const membershipSelect = {
  id: memberships.id,
  userId: memberships.userId,
  societyId: memberships.societyId,
  societyName: societies.name,
  towerName: towers.name,
  flatNo: units.flatNo,
  role: memberships.role,
  status: memberships.status,
  occupancy: memberships.occupancy,
  proofKey: memberships.proofKey,
  createdAt: memberships.createdAt,
};

export function membershipBase() {
  return db
    .select(membershipSelect)
    .from(memberships)
    .innerJoin(societies, eq(societies.id, memberships.societyId))
    .leftJoin(units, eq(units.id, memberships.unitId))
    .leftJoin(towers, eq(towers.id, units.towerId));
}

export function toMembershipView(r: {
  id: string;
  societyId: string;
  societyName: string;
  towerName: string | null;
  flatNo: string | null;
  role: "resident" | "society_admin";
  status: "pending" | "approved" | "rejected" | "revoked";
  occupancy: string;
  createdAt: Date;
}): MembershipView {
  return {
    id: r.id,
    societyId: r.societyId,
    societyName: r.societyName,
    towerName: r.towerName,
    flatNo: r.flatNo,
    role: r.role,
    status: r.status,
    occupancy: r.occupancy,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function membershipsOf(userId: string): Promise<MembershipView[]> {
  const rows = await membershipBase().where(eq(memberships.userId, userId)).orderBy(desc(memberships.createdAt));
  return rows.map(toMembershipView);
}

export async function membershipById(id: string): Promise<MembershipView | null> {
  const [r] = await membershipBase().where(eq(memberships.id, id)).limit(1);
  return r ? toMembershipView(r) : null;
}
