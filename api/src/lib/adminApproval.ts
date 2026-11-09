import { and, eq, lte, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../db/index.js";
import { adminRequests, memberships, societies, towers, units } from "../db/schema.js";
import {
  type AdminRequestRow,
  type ApproveBody,
  autoApproveDue,
  autoCloseNote,
  newSocietyPlan,
  nominationApprovalProblem,
} from "./adminRequests.js";
import { DomainError, notFound } from "./errors.js";
import { notifyUsers } from "./notify.js";

// Approving an admin request, shared by the platform route and the automatic
// approval of co-admin nominations (worker sweep + read-path backstop).
// Idempotent: the request row is locked, and only a `pending` row is acted on.

const conflictCode = (code: string) => new DomainError("CONFLICT", code);

/** join_admin and nominate_admin: flip the approved membership to society_admin. */
export async function promoteToAdmin(tx: DbOrTx, userId: string, societyId: string): Promise<void> {
  const promoted = await tx
    .update(memberships)
    .set({ role: "society_admin", adminSince: sql`coalesce(${memberships.adminSince}, now())` })
    .where(and(eq(memberships.userId, userId), eq(memberships.societyId, societyId), eq(memberships.status, "approved")))
    .returning({ id: memberships.id });
  if (!promoted.length) throw conflictCode("membership_not_active"); // rolls the transaction back
}

async function membershipOf(tx: DbOrTx, userId: string | null, societyId: string) {
  if (!userId) return null;
  const [m] = await tx
    .select({ status: memberships.status, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.societyId, societyId)))
    .limit(1);
  return m ?? null;
}

export type ApprovalResult =
  | { outcome: "approved"; row: AdminRequestRow }
  | { outcome: "closed"; row: AdminRequestRow; reason: "membership_not_active" | "nominator_not_admin" }
  | { outcome: "skipped"; row: AdminRequestRow | null };

/**
 * Approve one request in a single transaction.
 *
 * Manual (`auto` false, a platform admin): 409 not_pending unless pending;
 * nominations re-check nominee + nominator and 409 on failure.
 *
 * Automatic (`auto` true): acts only on a pending nomination whose
 * autoApproveAt has passed (else `skipped`, no error). If the re-check fails it
 * closes the request as `rejected` with a system note instead of promoting.
 */
export async function approveAdminRequest(
  id: string,
  opts: { reviewerId: string | null; now: Date; auto?: boolean; note?: string | null; overrides?: ApproveBody },
  q: typeof db = db,
): Promise<ApprovalResult> {
  const { reviewerId, now, auto = false } = opts;
  return q.transaction(async (tx) => {
    const [r] = await tx.select().from(adminRequests).where(eq(adminRequests.id, id)).for("update");
    if (!r) {
      if (auto) return { outcome: "skipped", row: null };
      throw notFound();
    }
    if (auto ? !autoApproveDue(r, now) : r.status !== "pending") {
      if (auto) return { outcome: "skipped", row: r };
      throw conflictCode("not_pending");
    }

    if (r.kind === "nominate_admin") {
      const problem = nominationApprovalProblem(
        await membershipOf(tx, r.requesterId, r.societyId!),
        await membershipOf(tx, r.nominatedBy, r.societyId!),
      );
      if (problem) {
        if (!auto) throw conflictCode(problem);
        const [closed] = await tx
          .update(adminRequests)
          .set({ status: "rejected", reviewedBy: null, reviewedAt: now, reviewNote: autoCloseNote(problem), updatedAt: now })
          .where(and(eq(adminRequests.id, r.id), eq(adminRequests.status, "pending")))
          .returning();
        return { outcome: "closed", row: closed ?? r, reason: problem };
      }
    }

    const [claimed] = await tx
      .update(adminRequests)
      .set({ status: "approved", reviewedBy: reviewerId, reviewedAt: now, reviewNote: opts.note || null, updatedAt: now })
      .where(and(eq(adminRequests.id, r.id), eq(adminRequests.status, "pending")))
      .returning();
    if (!claimed) {
      if (auto) return { outcome: "skipped", row: r };
      throw conflictCode("not_pending");
    }

    if (claimed.kind === "new_society") {
      if (!reviewerId) throw new Error("new_society needs a reviewer");
      const plan = newSocietyPlan(claimed, opts.overrides, reviewerId, now);
      const [s] = await tx.insert(societies).values(plan.society).returning({ id: societies.id });
      const [t] = await tx.insert(towers).values({ societyId: s.id, name: plan.towerName }).returning({ id: towers.id });
      const [u] = await tx.insert(units).values({ towerId: t.id, flatNo: plan.flatNo }).returning({ id: units.id });
      await tx.insert(memberships).values({ ...plan.membership, societyId: s.id, unitId: u.id });
      await tx.update(adminRequests).set({ societyId: s.id }).where(eq(adminRequests.id, claimed.id));
      return { outcome: "approved", row: { ...claimed, societyId: s.id } };
    }
    // join_admin and nominate_admin: the same promotion.
    await promoteToAdmin(tx, claimed.requesterId, claimed.societyId!);
    return { outcome: "approved", row: claimed };
  });
}

const log = (msg: string) => console.log(`[nominations] ${msg}`);

async function societyName(id: string | null): Promise<string> {
  if (!id) return "your society";
  const [s] = await db.select({ name: societies.name }).from(societies).where(eq(societies.id, id)).limit(1);
  return s?.name ?? "your society";
}

/** Emails after an automatic decision (fire-and-forget, like every notification). */
async function notifyAutoResult(res: ApprovalResult): Promise<void> {
  if (res.outcome === "skipped" || !res.row) return;
  const r = res.row;
  const name = await societyName(r.societyId);
  const people = [r.requesterId, ...(r.nominatedBy ? [r.nominatedBy] : [])];
  if (res.outcome === "approved") {
    await notifyUsers(people, "Co-admin nomination approved", `The co-admin nomination for "${name}" was approved. The nominee is now a society admin.`, "/admin-requests");
  } else {
    await notifyUsers(people, "Co-admin nomination closed", `The co-admin nomination for "${name}" was closed. ${autoCloseNote(res.reason)}`, "/admin-requests");
  }
}

/**
 * Approve every pending nomination whose 48 h are up. Run by the worker every
 * few minutes, and awaited on read paths as a backstop (filtered to what that
 * read shows). Idempotent and never throws: a failure is logged and the next
 * sweep or read retries it.
 */
export async function sweepDueNominations(
  filter: { requesterId?: string; societyId?: string } = {},
  now: Date = new Date(),
): Promise<number> {
  let approved = 0;
  try {
    const due = await db
      .select({ id: adminRequests.id })
      .from(adminRequests)
      .where(
        and(
          eq(adminRequests.kind, "nominate_admin"),
          eq(adminRequests.status, "pending"),
          lte(adminRequests.autoApproveAt, now),
          filter.requesterId ? eq(adminRequests.requesterId, filter.requesterId) : undefined,
          filter.societyId ? eq(adminRequests.societyId, filter.societyId) : undefined,
        ),
      )
      .limit(50);
    for (const { id } of due) {
      try {
        const res = await approveAdminRequest(id, { reviewerId: null, now, auto: true });
        if (res.outcome === "approved") approved++;
        if (res.outcome !== "skipped") {
          log(`${id}: ${res.outcome}`);
          void notifyAutoResult(res).catch((err) => log(`notify failed: ${String(err)}`));
        }
      } catch (err) {
        log(`approve ${id} failed: ${String(err)}`);
      }
    }
  } catch (err) {
    log(`sweep failed: ${String(err)}`);
  }
  return approved;
}
