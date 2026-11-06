import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { db } from "../db/index.js";
import { adminRequests, memberships, societies, towers, units, users } from "../db/schema.js";
import {
  type AdminRequestRow,
  adminRequestInsert,
  adminRequestView,
  approveBody,
  createAdminRequestBody,
  docKeyProblem,
  joinAdminEligibility,
  listStatusQuery,
  newSocietyPlan,
  requiredNoteBody,
} from "../lib/adminRequests.js";
import { isPlatformAdmin, requireSocietyAdmin } from "../lib/authz.js";
import { DomainError, forbidden, invalid, notFound } from "../lib/errors.js";
import { notifyPlatformAdmins, notifyUsers } from "../lib/notify.js";
import { presignDownload } from "../plugins/r2.js";
import { registerRateLimit } from "../plugins/rateLimit.js";

// Becoming a society admin (api/ROUTES.md "Admin requests"). Nobody gets
// role society_admin without a platform admin approving a documented request.

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const HOUR = 3_600_000;

const conflictCode = (code: string) => new DomainError("CONFLICT", code);

async function requirePlatformAdmin(userId: string): Promise<void> {
  if (!(await isPlatformAdmin(userId))) throw forbidden("platform_admin_required");
}

/** Name of each existing society referenced by these requests. */
async function societyInfo(rows: AdminRequestRow[]) {
  const ids = [...new Set(rows.map((r) => r.societyId).filter((x): x is string => Boolean(x)))];
  const ss = ids.length
    ? await db.select({ id: societies.id, name: societies.name, city: societies.city }).from(societies).where(inArray(societies.id, ids))
    : [];
  return new Map(ss.map((s) => [s.id, s]));
}

async function views(rows: AdminRequestRow[]) {
  const ss = await societyInfo(rows);
  return rows.map((r) => adminRequestView(r, r.societyId ? (ss.get(r.societyId)?.name ?? null) : null));
}

/** `PlatformAdminRequest[]`: AdminRequest + requester contact, society, presigned doc URLs. */
async function platformViews(rows: AdminRequestRow[]) {
  const ss = await societyInfo(rows);
  const userIds = [...new Set(rows.map((r) => r.requesterId))];
  const us = userIds.length
    ? await db
        .select({ id: users.id, displayName: users.displayName, email: users.email, phone: users.phone })
        .from(users)
        .where(inArray(users.id, userIds))
    : [];
  const byUser = new Map(us.map((u) => [u.id, u]));
  return Promise.all(
    rows.map(async (r) => {
      const society = r.societyId ? (ss.get(r.societyId) ?? null) : null;
      const [authorization, idProof, rwaRegistration] = await Promise.all([
        presignDownload(r.authorizationKey),
        presignDownload(r.idProofKey),
        r.rwaRegistrationKey ? presignDownload(r.rwaRegistrationKey) : Promise.resolve(undefined),
      ]);
      return {
        ...adminRequestView(r, society?.name ?? null),
        requester: byUser.get(r.requesterId) ?? null,
        society,
        docUrls: { ...(rwaRegistration ? { rwaRegistration } : {}), authorization, idProof },
      };
    }),
  );
}

async function requestOr404(id: string): Promise<AdminRequestRow> {
  const [r] = await db.select().from(adminRequests).where(eq(adminRequests.id, id)).limit(1);
  if (!r) throw notFound();
  return r;
}

/** `SocietyAdmin[]`: approved society_admin memberships, oldest admin first. */
export async function societyAdmins(societyId: string) {
  const since = sql<Date>`coalesce(${memberships.adminSince}, ${memberships.approvedAt}, ${memberships.createdAt})`;
  const rows = await db
    .select({
      membershipId: memberships.id,
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      phone: users.phone,
      towerName: towers.name,
      flatNo: units.flatNo,
      since,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(units, eq(units.id, memberships.unitId))
    .leftJoin(towers, eq(towers.id, units.towerId))
    .where(and(eq(memberships.societyId, societyId), eq(memberships.role, "society_admin"), eq(memberships.status, "approved")))
    .orderBy(asc(since));
  return rows.map((r) => ({
    membershipId: r.membershipId,
    user: { id: r.userId, displayName: r.displayName, email: r.email, phone: r.phone },
    towerName: r.towerName,
    flatNo: r.flatNo,
    since: new Date(r.since).toISOString(),
  }));
}

async function societyExistsOr404(id: string): Promise<void> {
  const [s] = await db.select({ id: societies.id }).from(societies).where(eq(societies.id, id)).limit(1);
  if (!s) throw notFound();
}

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "23505";

export async function adminRequestRoutes(fastify: FastifyInstance) {
  await registerRateLimit(fastify);
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // --- requester -------------------------------------------------------------

  app.post(
    "/admin-requests",
    { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: HOUR } }, schema: { body: createAdminRequestBody } },
    async (req, reply) => {
      const me = req.userId!;
      const b = req.body;
      const problem = docKeyProblem(me, b);
      if (problem) throw invalid(problem);

      let societyName: string;
      if (b.kind === "join_admin") {
        const [m] = await db
          .select({ status: memberships.status, role: memberships.role, societyName: societies.name })
          .from(memberships)
          .innerJoin(societies, eq(societies.id, memberships.societyId))
          .where(and(eq(memberships.userId, me), eq(memberships.societyId, b.societyId)))
          .limit(1);
        const verdict = joinAdminEligibility(m ?? null);
        if (verdict === "not_found") throw notFound();
        if (verdict === "already_admin") throw conflictCode("already_admin");
        societyName = m.societyName;
      } else {
        societyName = b.societyName;
      }

      const [pending] = await db
        .select({ id: adminRequests.id })
        .from(adminRequests)
        .where(
          and(
            eq(adminRequests.requesterId, me),
            eq(adminRequests.kind, b.kind),
            eq(adminRequests.status, "pending"),
            b.kind === "join_admin" ? eq(adminRequests.societyId, b.societyId) : undefined,
          ),
        )
        .limit(1);
      if (pending) throw conflictCode("request_pending");

      let row: AdminRequestRow;
      try {
        [row] = await db.insert(adminRequests).values(adminRequestInsert(me, b)).returning();
      } catch (err) {
        if (isUniqueViolation(err)) throw conflictCode("request_pending"); // raced a duplicate
        throw err;
      }
      await notifyPlatformAdmins(
        "New BorrowVault admin request",
        b.kind === "new_society"
          ? `A request to register "${societyName}" and become its admin is waiting for review.`
          : `A request to become an admin of "${societyName}" is waiting for review.`,
        "/platform/admin-requests",
      );
      return reply.code(201).send(adminRequestView(row, societyName));
    },
  );

  app.get("/admin-requests/mine", { preHandler: requireAuth }, async (req) => {
    const rows = await db
      .select()
      .from(adminRequests)
      .where(eq(adminRequests.requesterId, req.userId!))
      .orderBy(desc(adminRequests.createdAt));
    return views(rows);
  });

  app.post("/admin-requests/:id/withdraw", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    const me = req.userId!;
    const [r] = await db
      .update(adminRequests)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(and(eq(adminRequests.id, req.params.id), eq(adminRequests.requesterId, me), eq(adminRequests.status, "pending")))
      .returning();
    if (!r) {
      const existing = await requestOr404(req.params.id);
      if (existing.requesterId !== me) throw notFound();
      throw conflictCode("not_pending");
    }
    return (await views([r]))[0];
  });

  // --- platform admin --------------------------------------------------------

  app.get("/platform/admin-requests", { preHandler: requireAuth, schema: { querystring: listStatusQuery } }, async (req) => {
    await requirePlatformAdmin(req.userId!);
    const status = req.query.status;
    const rows = await db
      .select()
      .from(adminRequests)
      .where(eq(adminRequests.status, status))
      .orderBy(status === "pending" ? asc(adminRequests.createdAt) : desc(adminRequests.createdAt))
      .limit(200);
    return platformViews(rows);
  });

  app.post(
    "/platform/admin-requests/:id/approve",
    { preHandler: requireAuth, schema: { params: idParams, body: approveBody } },
    async (req) => {
      const reviewer = req.userId!;
      await requirePlatformAdmin(reviewer);
      const r = await requestOr404(req.params.id);
      const now = new Date();
      await db.transaction(async (tx) => {
        // Claim the request first: a concurrent approve/reject/withdraw loses here.
        const [claimed] = await tx
          .update(adminRequests)
          .set({ status: "approved", reviewedBy: reviewer, reviewedAt: now, reviewNote: req.body?.note || null, updatedAt: now })
          .where(and(eq(adminRequests.id, r.id), eq(adminRequests.status, "pending")))
          .returning();
        if (!claimed) throw conflictCode("not_pending");

        if (claimed.kind === "new_society") {
          const plan = newSocietyPlan(claimed, req.body, reviewer, now);
          const [s] = await tx.insert(societies).values(plan.society).returning({ id: societies.id });
          const [t] = await tx.insert(towers).values({ societyId: s.id, name: plan.towerName }).returning({ id: towers.id });
          const [u] = await tx.insert(units).values({ towerId: t.id, flatNo: plan.flatNo }).returning({ id: units.id });
          await tx.insert(memberships).values({ ...plan.membership, societyId: s.id, unitId: u.id });
          await tx.update(adminRequests).set({ societyId: s.id }).where(eq(adminRequests.id, claimed.id));
        } else {
          const promoted = await tx
            .update(memberships)
            .set({ role: "society_admin", adminSince: sql`coalesce(${memberships.adminSince}, now())` })
            .where(
              and(
                eq(memberships.userId, claimed.requesterId),
                eq(memberships.societyId, claimed.societyId!),
                eq(memberships.status, "approved"),
              ),
            )
            .returning({ id: memberships.id });
          if (!promoted.length) throw conflictCode("membership_not_active"); // rolls the claim back too
        }
      });
      const done = await requestOr404(r.id);
      const [view] = await platformViews([done]);
      const note = req.body?.note ? `\n\nNote from BorrowVault: ${req.body.note}` : "";
      await notifyUsers(
        [done.requesterId],
        "Your BorrowVault admin request was approved",
        `You are now a society admin of "${view.societyName}".${note}`,
        "/",
      );
      return view;
    },
  );

  app.post(
    "/platform/admin-requests/:id/reject",
    { preHandler: requireAuth, schema: { params: idParams, body: requiredNoteBody } },
    async (req) => {
      const reviewer = req.userId!;
      await requirePlatformAdmin(reviewer);
      const r = await requestOr404(req.params.id);
      const now = new Date();
      const [done] = await db
        .update(adminRequests)
        .set({ status: "rejected", reviewedBy: reviewer, reviewedAt: now, reviewNote: req.body.note, updatedAt: now })
        .where(and(eq(adminRequests.id, r.id), eq(adminRequests.status, "pending")))
        .returning();
      if (!done) throw conflictCode("not_pending");
      const [view] = await platformViews([done]);
      await notifyUsers(
        [done.requesterId],
        "Your BorrowVault admin request was not approved",
        `Your request for "${view.societyName}" was rejected.\n\nReason: ${req.body.note}\n\nYou can submit a new request with updated documents.`,
        "/",
      );
      return view;
    },
  );

  app.get("/platform/societies/:id/admins", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    await requirePlatformAdmin(req.userId!);
    await societyExistsOr404(req.params.id);
    return societyAdmins(req.params.id);
  });

  app.post(
    "/platform/societies/:id/admins/:membershipId/revoke-admin",
    { preHandler: requireAuth, schema: { params: z.object({ id: uuid, membershipId: uuid }), body: requiredNoteBody } },
    async (req) => {
      await requirePlatformAdmin(req.userId!);
      const { id: societyId, membershipId } = req.params;
      const [m] = await db
        .update(memberships)
        .set({ role: "resident", adminSince: null, reviewNote: req.body.note })
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.societyId, societyId),
            eq(memberships.role, "society_admin"),
            eq(memberships.status, "approved"),
          ),
        )
        .returning({ userId: memberships.userId });
      if (!m) {
        const [exists] = await db
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.id, membershipId), eq(memberships.societyId, societyId)))
          .limit(1);
        if (!exists) throw notFound();
        throw conflictCode("not_admin");
      }
      // Zero admins left is allowed: disputes then escalate to the platform
      // after 72 h as usual, and platform admins can always rule.
      await notifyUsers([m.userId], "Your BorrowVault admin role was removed", `You are no longer a society admin. You remain a resident.\n\nReason: ${req.body.note}`, "/");
      return societyAdmins(societyId);
    },
  );

  // --- society admin (read-only) ---------------------------------------------

  app.get("/admin/societies/:id/admins", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    await requireSocietyAdmin(req.userId!, req.params.id);
    return societyAdmins(req.params.id);
  });
}
