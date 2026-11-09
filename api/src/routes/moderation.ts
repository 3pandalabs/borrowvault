import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { partyInfos } from "../chat/store.js";
import { requireSocietyAdmin, sharesUnitWithParty } from "../lib/authz.js";
import { notFound } from "../lib/errors.js";
import * as moderation from "../lib/moderation.js";
import { presignDownload } from "../plugins/r2.js";

// Society console "Reports" page: user and listing reports (api/ROUTES.md
// "Reports review"). Message reports live in routes/chat.ts.

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const statusQuery = z.object({ status: z.enum(["open", "closed"]).default("open") });
const noteBody = z.object({ note: z.string().trim().max(1000).optional() }).nullish();

/** Arbiter rule for reports: not a side, and not living in either side's unit. */
async function mayReview(adminId: string, societyId: string, a: string, b: string): Promise<boolean> {
  if (adminId === a || adminId === b) return false;
  return !(await sharesUnitWithParty(adminId, { societyId, lenderId: a, borrowerId: b }));
}

async function userReportViews(societyId: string, rows: moderation.UserReportRow[]) {
  const parties = await partyInfos(societyId, rows.flatMap((r) => [r.reporterId, r.reportedId]));
  return rows.map((r) => ({
    id: r.id,
    societyId: r.societyId,
    status: r.status,
    reason: r.reason,
    details: r.details,
    reporter: parties.get(r.reporterId)!,
    reported: parties.get(r.reportedId)!,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    reviewNote: r.reviewNote,
  }));
}

async function listingReportViews(societyId: string, rows: Awaited<ReturnType<typeof moderation.listListingReports>>) {
  const parties = await partyInfos(societyId, rows.flatMap(({ r, l }) => [r.reporterId, l.ownerId]));
  return Promise.all(
    rows.map(async ({ r, l }) => ({
      id: r.id,
      societyId: r.societyId,
      status: r.status,
      reason: r.reason,
      details: r.details,
      reporter: parties.get(r.reporterId)!,
      listing: {
        id: l.id,
        title: l.title,
        status: l.status,
        coverUrl: l.photoKeys[0] ? await presignDownload(l.photoKeys[0]) : null,
        owner: parties.get(l.ownerId)!,
      },
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      reviewNote: r.reviewNote,
    })),
  );
}

export async function moderationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/admin/societies/:id/user-reports",
    { preHandler: requireAuth, schema: { params: idParams, querystring: statusQuery } },
    async (req) => {
      const me = req.userId!;
      await requireSocietyAdmin(me, req.params.id);
      const rows = await moderation.listUserReports(req.params.id, req.query.status);
      const visible: typeof rows = [];
      for (const r of rows) if (await mayReview(me, r.societyId, r.reporterId, r.reportedId)) visible.push(r);
      return userReportViews(req.params.id, visible);
    },
  );

  app.post(
    "/admin/user-reports/:id/review",
    {
      preHandler: requireAuth,
      schema: {
        params: idParams,
        body: z.object({ decision: z.enum(["reviewed", "dismissed"]), note: z.string().trim().max(1000).optional() }),
      },
    },
    async (req) => {
      const me = req.userId!;
      const found = await moderation.findUserReport(req.params.id);
      if (!found) throw notFound();
      await requireSocietyAdmin(me, found.societyId);
      if (!(await mayReview(me, found.societyId, found.reporterId, found.reportedId))) throw notFound();
      const r = found.status === "open" ? await moderation.reviewUserReport(found.id, me, req.body.decision, req.body.note || null) : found;
      const [view] = await userReportViews(found.societyId, [r]);
      return view;
    },
  );

  app.get(
    "/admin/societies/:id/listing-reports",
    { preHandler: requireAuth, schema: { params: idParams, querystring: statusQuery } },
    async (req) => {
      const me = req.userId!;
      await requireSocietyAdmin(me, req.params.id);
      const rows = await moderation.listListingReports(req.params.id, req.query.status);
      const visible: typeof rows = [];
      for (const row of rows) if (await mayReview(me, row.r.societyId, row.r.reporterId, row.l.ownerId)) visible.push(row);
      return listingReportViews(req.params.id, visible);
    },
  );

  app.post(
    "/admin/listing-reports/:id/dismiss",
    { preHandler: requireAuth, schema: { params: idParams, body: noteBody } },
    async (req) => {
      const me = req.userId!;
      const found = await moderation.findListingReport(req.params.id);
      if (!found) throw notFound();
      await requireSocietyAdmin(me, found.r.societyId);
      if (!(await mayReview(me, found.r.societyId, found.r.reporterId, found.l.ownerId))) throw notFound();
      if (found.r.status === "open") await moderation.dismissListingReport(found.r.id, me, req.body?.note || null);
      const fresh = (await moderation.findListingReport(found.r.id))!;
      const [view] = await listingReportViews(found.r.societyId, [fresh]);
      return view;
    },
  );
}
