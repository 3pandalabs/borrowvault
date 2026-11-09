import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { db } from "../db/index.js";
import { adminRequests, memberships, societies, towers, units, users } from "../db/schema.js";
import { approveAdminRequest, sweepDueNominations } from "../lib/adminApproval.js";
import {
  type AdminRequestRow,
  acceptNominationBody,
  adminRequestInsert,
  adminRequestView,
  approveBody,
  autoApproveAtFor,
  createAdminRequestBody,
  docKeyProblem,
  joinAdminEligibility,
  listStatusQuery,
  nominateBody,
  nominationEligibility,
  nominationInsert,
  ownDocsProblem,
  requiredNoteBody,
  resultingTier,
} from "../lib/adminRequests.js";
import { approvedMembership, isPlatformAdmin, requireSocietyAdmin } from "../lib/authz.js";
import { DomainError, forbidden, invalid, notFound } from "../lib/errors.js";
import { notifyPlatformAdmins, notifyUsers } from "../lib/notify.js";
import { memberCountSql } from "../lib/societyTier.js";
import { presignDownload } from "../plugins/r2.js";
import { registerRateLimit } from "../plugins/rateLimit.js";

// Becoming a society admin (api/ROUTES.md "Admin requests"). Every path needs
// the person's own ID proof: new_society and join_admin are approved by a
// platform admin; a co-admin nomination is approved automatically 48 h after
// the nominee uploads their ID, unless a platform admin rejects it first.

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const HOUR = 3_600_000;

const conflictCode = (code: string) => new DomainError("CONFLICT", code);

async function requirePlatformAdmin(userId: string): Promise<void> {
  if (!(await isPlatformAdmin(userId))) throw forbidden("platform_admin_required");
}

/** Name, tier and member count of each existing society referenced by these requests. */
async function societyInfo(rows: AdminRequestRow[]) {
  const ids = [...new Set(rows.map((r) => r.societyId).filter((x): x is string => Boolean(x)))];
  const ss = ids.length
    ? await db
        .select({ id: societies.id, name: societies.name, city: societies.city, tier: societies.tier, memberCount: memberCountSql })
        .from(societies)
        .where(inArray(societies.id, ids))
    : [];
  return new Map(ss.map((s) => [s.id, { ...s, memberCount: Number(s.memberCount) }]));
}

/** Contact details of the given users. */
async function usersById(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const us = unique.length
    ? await db
        .select({ id: users.id, displayName: users.displayName, email: users.email, phone: users.phone })
        .from(users)
        .where(inArray(users.id, unique))
    : [];
  return new Map(us.map((u) => [u.id, u]));
}

function nominatorOf(r: AdminRequestRow, byUser: Map<string, { id: string; displayName: string }>) {
  const u = r.nominatedBy ? byUser.get(r.nominatedBy) : undefined;
  return u ? { id: u.id, displayName: u.displayName } : null;
}

async function views(rows: AdminRequestRow[]) {
  const [ss, byUser] = await Promise.all([societyInfo(rows), usersById(rows.map((r) => r.nominatedBy))]);
  return rows.map((r) => adminRequestView(r, r.societyId ? (ss.get(r.societyId)?.name ?? null) : null, nominatorOf(r, byUser)));
}

/** `PlatformAdminRequest[]`: AdminRequest + requester contact, society, resulting tier, presigned doc URLs. */
async function platformViews(rows: AdminRequestRow[]) {
  const [ss, byUser] = await Promise.all([
    societyInfo(rows),
    usersById(rows.flatMap((r) => [r.requesterId, r.nominatedBy])),
  ]);
  const url = (k: string | null) => (k ? presignDownload(k) : Promise.resolve(undefined));
  return Promise.all(
    rows.map(async (r) => {
      const society = r.societyId ? (ss.get(r.societyId) ?? null) : null;
      const [idProof, residenceProof, rwaRegistration, authorization] = await Promise.all([
        url(r.idProofKey),
        url(r.residenceProofKey),
        url(r.rwaRegistrationKey),
        url(r.authorizationKey),
      ]);
      return {
        ...adminRequestView(r, society?.name ?? null, nominatorOf(r, byUser)),
        requester: byUser.get(r.requesterId) ?? null,
        society,
        resultingTier: resultingTier(r),
        docUrls: {
          ...(idProof ? { idProof } : {}),
          ...(residenceProof ? { residenceProof } : {}),
          ...(rwaRegistration ? { rwaRegistration } : {}),
          ...(authorization ? { authorization } : {}),
        },
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

/** An open co-admin nomination or a pending join_admin request for this person in this society. */
async function hasOpenAdminRequest(userId: string, societyId: string, kinds: ("join_admin" | "nominate_admin")[]) {
  const [row] = await db
    .select({ id: adminRequests.id })
    .from(adminRequests)
    .where(
      and(
        eq(adminRequests.requesterId, userId),
        eq(adminRequests.societyId, societyId),
        or(
          kinds.includes("join_admin") ? and(eq(adminRequests.kind, "join_admin"), eq(adminRequests.status, "pending")) : undefined,
          kinds.includes("nominate_admin")
            ? and(eq(adminRequests.kind, "nominate_admin"), inArray(adminRequests.status, ["nominated", "pending"]))
            : undefined,
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
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
        if (await hasOpenAdminRequest(me, b.societyId, ["join_admin", "nominate_admin"])) throw conflictCode("request_pending");
      } else {
        societyName = b.societyName;
        const [pending] = await db
          .select({ id: adminRequests.id })
          .from(adminRequests)
          .where(and(eq(adminRequests.requesterId, me), eq(adminRequests.kind, "new_society"), eq(adminRequests.status, "pending")))
          .limit(1);
        if (pending) throw conflictCode("request_pending");
      }

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
        "/platform",
      );
      return reply.code(201).send(adminRequestView(row, societyName));
    },
  );

  app.get("/admin-requests/mine", { preHandler: requireAuth }, async (req) => {
    await sweepDueNominations({ requesterId: req.userId! });
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

  // --- nominee: accept (ID proof required) or decline ------------------------

  /** The nomination, if the caller is its nominee (404 otherwise). */
  async function nominationForNominee(id: string, me: string): Promise<AdminRequestRow> {
    const r = await requestOr404(id);
    if (r.kind !== "nominate_admin" || r.requesterId !== me) throw notFound();
    return r;
  }

  app.post(
    "/admin-requests/:id/accept",
    { preHandler: requireAuth, schema: { params: idParams, body: acceptNominationBody } },
    async (req) => {
      const me = req.userId!;
      const r = await nominationForNominee(req.params.id, me);
      if (r.status !== "nominated") throw conflictCode("not_nominated");
      const problem = ownDocsProblem(me, [req.body.idProofKey]);
      if (problem) throw invalid(problem);
      if (!(await approvedMembership(me, r.societyId!))) throw conflictCode("membership_not_active");
      const now = new Date();
      const [done] = await db
        .update(adminRequests)
        .set({
          status: "pending",
          idProofKey: req.body.idProofKey,
          statement: req.body.statement ? req.body.statement : null,
          nomineeAcceptedAt: now,
          autoApproveAt: autoApproveAtFor(now),
          updatedAt: now,
        })
        .where(and(eq(adminRequests.id, r.id), eq(adminRequests.status, "nominated")))
        .returning();
      if (!done) throw conflictCode("not_nominated");
      const [view] = await views([done]);
      await notifyPlatformAdmins(
        "Co-admin nomination to review",
        `A co-admin nomination for "${view.societyName}" was accepted. It is approved automatically in 48 hours unless you reject it.`,
        "/platform",
      );
      if (done.nominatedBy) {
        await notifyUsers(
          [done.nominatedBy],
          "Your co-admin nomination was accepted",
          `Your nominee for "${view.societyName}" uploaded their ID. They become an admin in 48 hours unless the BorrowVault team rejects it.`,
          `/admin/${done.societyId}`,
        );
      }
      return view;
    },
  );

  app.post("/admin-requests/:id/decline", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    const me = req.userId!;
    const r = await nominationForNominee(req.params.id, me);
    const [done] = await db
      .update(adminRequests)
      .set({ status: "declined", updatedAt: new Date() })
      .where(and(eq(adminRequests.id, r.id), eq(adminRequests.status, "nominated")))
      .returning();
    if (!done) throw conflictCode("not_nominated");
    const [view] = await views([done]);
    if (done.nominatedBy) {
      await notifyUsers([done.nominatedBy], "Co-admin nomination declined", `Your co-admin nomination for "${view.societyName}" was declined.`, `/admin/${done.societyId}`);
    }
    return view;
  });

  // --- nominator: cancel -----------------------------------------------------

  app.post("/admin-requests/:id/cancel", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    const me = req.userId!;
    const r = await requestOr404(req.params.id);
    if (r.kind !== "nominate_admin" || r.nominatedBy !== me) throw notFound();
    const [done] = await db
      .update(adminRequests)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(adminRequests.id, r.id), inArray(adminRequests.status, ["nominated", "pending"])))
      .returning();
    if (!done) throw conflictCode("not_pending");
    const [view] = await views([done]);
    await notifyUsers([done.requesterId], "Co-admin nomination cancelled", `Your co-admin nomination for "${view.societyName}" was cancelled.`, "/admin-requests");
    return view;
  });

  // --- society admin: nominate a co-admin ------------------------------------

  app.post(
    "/admin/societies/:id/nominations",
    { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: HOUR } }, schema: { params: idParams, body: nominateBody } },
    async (req, reply) => {
      const me = req.userId!;
      const societyId = req.params.id;
      const [caller, callerIsPlatformAdmin, [target]] = await Promise.all([
        approvedMembership(me, societyId),
        isPlatformAdmin(me),
        db
          .select({
            id: memberships.id,
            userId: memberships.userId,
            societyId: memberships.societyId,
            status: memberships.status,
            role: memberships.role,
          })
          .from(memberships)
          .where(eq(memberships.id, req.body.membershipId))
          .limit(1),
      ]);
      const verdict = nominationEligibility({
        caller,
        callerIsPlatformAdmin,
        callerId: me,
        societyId,
        target: target ?? null,
        targetHasOpenRequest:
          target && target.societyId === societyId ? await hasOpenAdminRequest(target.userId, societyId, ["join_admin", "nominate_admin"]) : false,
      });
      if (verdict === "not_found") throw notFound();
      if (verdict === "society_admin_required") throw forbidden("society_admin_required");
      if (verdict === "cannot_nominate_self") throw invalid("cannot_nominate_self");
      if (verdict !== "ok") throw conflictCode(verdict);

      let row: AdminRequestRow;
      try {
        [row] = await db
          .insert(adminRequests)
          .values(nominationInsert({ nomineeId: target.userId, nominatorId: me, societyId, committeeRole: req.body.committeeRole }))
          .returning();
      } catch (err) {
        if (isUniqueViolation(err)) throw conflictCode("request_pending"); // raced a duplicate
        throw err;
      }
      const [view] = await views([row]);
      await notifyUsers(
        [target.userId],
        "You were nominated as a co-admin",
        `${view.nominatedBy?.displayName || "An admin"} nominated you as a co-admin of "${view.societyName}". To accept, open your admin requests and upload your ID proof. You can also decline.`,
        "/admin-requests",
      );
      return reply.code(201).send(view);
    },
  );

  app.get("/admin/societies/:id/nominations", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    await requireSocietyAdmin(req.userId!, req.params.id);
    await sweepDueNominations({ societyId: req.params.id });
    const rows = await db
      .select()
      .from(adminRequests)
      .where(and(eq(adminRequests.societyId, req.params.id), eq(adminRequests.kind, "nominate_admin")))
      .orderBy(desc(adminRequests.createdAt))
      .limit(100);
    return views(rows);
  });

  // --- platform admin --------------------------------------------------------

  app.get("/platform/admin-requests", { preHandler: requireAuth, schema: { querystring: listStatusQuery } }, async (req) => {
    await requirePlatformAdmin(req.userId!);
    await sweepDueNominations();
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
      const res = await approveAdminRequest(req.params.id, {
        reviewerId: reviewer,
        now: new Date(),
        note: req.body?.note || null,
        overrides: req.body,
      });
      const done = await requestOr404(res.row!.id);
      const [view] = await platformViews([done]);
      const note = req.body?.note ? `\n\nNote from BorrowVault: ${req.body.note}` : "";
      const pilot =
        done.kind === "new_society"
          ? "\n\nIt starts as a pilot society: up to 50 members, deposits and replacement values up to ₹5,000, and the BorrowVault team rules disputes. We lift these limits once we verify the society."
          : "";
      await notifyUsers(
        [done.requesterId],
        "Your BorrowVault admin request was approved",
        `You are now a society admin of "${view.societyName}".${pilot}${note}`,
        "/",
      );
      if (done.nominatedBy) {
        await notifyUsers([done.nominatedBy], "Co-admin nomination approved", `Your nominee is now a co-admin of "${view.societyName}".`, `/admin/${done.societyId}`);
      }
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
      if (done.nominatedBy) {
        await notifyUsers(
          [done.nominatedBy],
          "Co-admin nomination rejected",
          `Your co-admin nomination for "${view.societyName}" was rejected.\n\nReason: ${req.body.note}`,
          `/admin/${done.societyId}`,
        );
      }
      return view;
    },
  );

  app.get("/platform/societies/:id/admins", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    await requirePlatformAdmin(req.userId!);
    await societyExistsOr404(req.params.id);
    await sweepDueNominations({ societyId: req.params.id });
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
    await sweepDueNominations({ societyId: req.params.id });
    return societyAdmins(req.params.id);
  });
}
