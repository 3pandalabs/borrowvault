import { randomInt } from "node:crypto";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { bookingSummaries, disputeView } from "../booking/view.js";
import { db } from "../db/index.js";
import { bookings, disputes, inviteCodes, memberships, societies, towers, users } from "../db/schema.js";
import { isPlatformAdmin, requireSocietyAdmin } from "../lib/authz.js";
import { conflict, forbidden, invalid, notFound } from "../lib/errors.js";
import { notifyUsers } from "../lib/notify.js";
import { membershipBase, membershipById, toMembershipView } from "../lib/users.js";

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const INVITE_TTL_MS = 30 * 24 * 3_600_000;

function inviteCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return s;
}

async function societyOr404(id: string) {
  const [s] = await db.select().from(societies).where(eq(societies.id, id)).limit(1);
  if (!s) throw notFound();
  return s;
}

function societyView(s: typeof societies.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    city: s.city,
    centerLat: s.centerLat,
    centerLng: s.centerLng,
    radiusM: s.radiusM,
    status: s.status,
    settings: { depositMode: s.settings?.depositMode ?? "declared" },
  };
}

export async function adminRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // --- society admin ---------------------------------------------------------

  app.get("/admin/societies/:id", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    await requireSocietyAdmin(req.userId!, req.params.id);
    return societyView(await societyOr404(req.params.id));
  });

  app.get("/admin/societies/:id/invite-codes", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    await requireSocietyAdmin(req.userId!, req.params.id);
    const rows = await db
      .select({
        code: inviteCodes.code,
        towerId: inviteCodes.towerId,
        towerName: towers.name,
        expiresAt: inviteCodes.expiresAt,
        usedCount: sql<number>`(select count(*) from ${memberships} where ${memberships.inviteCodeId} = ${inviteCodes.id})::int`,
      })
      .from(inviteCodes)
      .innerJoin(towers, eq(towers.id, inviteCodes.towerId))
      .where(eq(inviteCodes.societyId, req.params.id))
      .orderBy(desc(inviteCodes.createdAt));
    return rows.map((r) => ({ ...r, expiresAt: r.expiresAt.toISOString() }));
  });

  app.get(
    "/admin/societies/:id/memberships",
    {
      preHandler: requireAuth,
      schema: { params: idParams, querystring: z.object({ status: z.enum(["pending", "approved", "rejected", "revoked"]).optional() }) },
    },
    async (req) => {
      await requireSocietyAdmin(req.userId!, req.params.id);
      const rows = await membershipBase()
        .where(
          and(
            eq(memberships.societyId, req.params.id),
            req.query.status ? eq(memberships.status, req.query.status) : undefined,
          ),
        )
        .orderBy(desc(memberships.createdAt));
      const userIds = [...new Set(rows.map((r) => r.userId))];
      const us = userIds.length
        ? await db
            .select({ id: users.id, displayName: users.displayName, email: users.email, phone: users.phone })
            .from(users)
            .where(inArray(users.id, userIds))
        : [];
      const byId = new Map(us.map((u) => [u.id, u]));
      return rows.map((r) => ({ ...toMembershipView(r), user: byId.get(r.userId) ?? null, proofKey: r.proofKey }));
    },
  );

  async function review(
    adminId: string,
    membershipId: string,
    to: "approved" | "rejected" | "revoked",
    note: string | null,
  ) {
    const [m] = await db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1);
    if (!m) throw notFound();
    await requireSocietyAdmin(adminId, m.societyId);
    if (m.userId === adminId && !(await isPlatformAdmin(adminId))) throw forbidden("you cannot review your own membership");
    const from = to === "revoked" ? ["approved"] : ["pending"];
    if (!from.includes(m.status)) throw conflict(`membership is ${m.status}`);
    const updated = await db
      .update(memberships)
      .set({
        status: to,
        reviewNote: note,
        ...(to === "approved" ? { approvedBy: adminId, approvedAt: new Date() } : {}),
      })
      .where(and(eq(memberships.id, m.id), eq(memberships.status, m.status)))
      .returning({ id: memberships.id });
    if (!updated.length) throw conflict("membership changed, reload");
    await notifyUsers([m.userId], `Your BorrowVault membership was ${to}`, note ? `Note from the society admin: ${note}` : `Your membership was ${to}.`, "/");
    return membershipById(m.id);
  }

  const noteBody = z.object({ note: z.string().max(1000).optional() }).optional();

  app.post("/admin/memberships/:id/approve", { preHandler: requireAuth, schema: { params: idParams, body: noteBody } }, async (req) =>
    review(req.userId!, req.params.id, "approved", req.body?.note ?? null),
  );
  app.post("/admin/memberships/:id/reject", { preHandler: requireAuth, schema: { params: idParams, body: noteBody } }, async (req) =>
    review(req.userId!, req.params.id, "rejected", req.body?.note ?? null),
  );
  app.post("/admin/memberships/:id/revoke", { preHandler: requireAuth, schema: { params: idParams, body: noteBody } }, async (req) =>
    review(req.userId!, req.params.id, "revoked", req.body?.note ?? null),
  );

  app.post(
    "/admin/societies/:id/towers",
    { preHandler: requireAuth, schema: { params: idParams, body: z.object({ name: z.string().trim().min(1).max(60) }) } },
    async (req, reply) => {
      await requireSocietyAdmin(req.userId!, req.params.id);
      const [t] = await db
        .insert(towers)
        .values({ societyId: req.params.id, name: req.body.name })
        .onConflictDoNothing()
        .returning({ id: towers.id, name: towers.name });
      if (!t) throw conflict("a tower with that name already exists");
      return reply.code(201).send(t);
    },
  );

  app.post(
    "/admin/societies/:id/invite-codes",
    { preHandler: requireAuth, schema: { params: idParams, body: z.object({ towerId: uuid }) } },
    async (req, reply) => {
      await requireSocietyAdmin(req.userId!, req.params.id);
      const [t] = await db.select().from(towers).where(and(eq(towers.id, req.body.towerId), eq(towers.societyId, req.params.id)));
      if (!t) throw invalid("unknown tower");
      for (let attempt = 0; attempt < 5; attempt++) {
        const [row] = await db
          .insert(inviteCodes)
          .values({
            societyId: req.params.id,
            towerId: t.id,
            code: inviteCode(),
            createdBy: req.userId!,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          })
          .onConflictDoNothing()
          .returning();
        if (row) return reply.code(201).send({ code: row.code, expiresAt: row.expiresAt.toISOString() });
      }
      throw new Error("could not generate a unique invite code");
    },
  );

  app.patch(
    "/admin/societies/:id",
    {
      preHandler: requireAuth,
      schema: {
        params: idParams,
        body: z.object({
          centerLat: z.number().min(-90).max(90).optional(),
          centerLng: z.number().min(-180).max(180).optional(),
          radiusM: z.number().int().min(50).max(5000).optional(),
          settings: z.object({ depositMode: z.enum(["declared", "p2p"]).optional() }).optional(),
        }),
      },
    },
    async (req) => {
      await requireSocietyAdmin(req.userId!, req.params.id);
      const s = await societyOr404(req.params.id);
      const b = req.body;
      const [u] = await db
        .update(societies)
        .set({
          ...(b.centerLat !== undefined ? { centerLat: b.centerLat } : {}),
          ...(b.centerLng !== undefined ? { centerLng: b.centerLng } : {}),
          ...(b.radiusM !== undefined ? { radiusM: b.radiusM } : {}),
          ...(b.settings ? { settings: { ...s.settings, ...b.settings } } : {}),
        })
        .where(eq(societies.id, s.id))
        .returning();
      return societyView(u);
    },
  );

  app.get(
    "/admin/societies/:id/disputes",
    {
      preHandler: requireAuth,
      schema: {
        params: idParams,
        querystring: z.object({
          status: z.enum(["open", "awaiting_response", "under_review", "escalated", "resolved", "withdrawn"]).optional(),
        }),
      },
    },
    async (req) => {
      await requireSocietyAdmin(req.userId!, req.params.id);
      const rows = await db
        .select({ d: disputes, b: bookings })
        .from(disputes)
        .innerJoin(bookings, eq(bookings.id, disputes.bookingId))
        .where(and(eq(bookings.societyId, req.params.id), statusFilter(req.query.status)))
        .orderBy(desc(disputes.createdAt))
        .limit(200);
      const summaries = await bookingSummaries(
        rows.map((r) => r.b),
        req.userId!,
      );
      return rows.map((r, i) => ({ ...disputeView(r.d), booking: summaries[i] }));
    },
  );

  // --- platform admin --------------------------------------------------------

  app.get("/platform/societies", { preHandler: requireAuth }, async (req) => {
    if (!(await isPlatformAdmin(req.userId!))) throw forbidden("platform_admin_required");
    const rows = await db.select().from(societies).orderBy(desc(societies.createdAt));
    return rows.map(societyView);
  });

  app.post(
    "/platform/societies",
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({
          name: z.string().trim().min(2).max(120),
          city: z.string().trim().min(2).max(80),
          centerLat: z.number().min(-90).max(90),
          centerLng: z.number().min(-180).max(180),
          radiusM: z.number().int().min(50).max(5000),
          adminUserEmail: z.string().email(),
        }),
      },
    },
    async (req, reply) => {
      if (!(await isPlatformAdmin(req.userId!))) throw forbidden("platform_admin_required");
      const b = req.body;
      const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.email, b.adminUserEmail.toLowerCase()));
      if (!admin) throw invalid("no user with adminUserEmail; they must sign up first");
      const s = await db.transaction(async (tx) => {
        const [s] = await tx
          .insert(societies)
          .values({ name: b.name, city: b.city, centerLat: b.centerLat, centerLng: b.centerLng, radiusM: b.radiusM, status: "live" })
          .returning();
        await tx.insert(memberships).values({
          userId: admin.id,
          societyId: s.id,
          role: "society_admin",
          status: "approved",
          occupancy: "owner",
          via: "platform",
          approvedBy: req.userId!,
          approvedAt: new Date(),
        });
        return s;
      });
      return reply.code(201).send(societyView(s));
    },
  );
}

// "open" means any unresolved dispute (open / awaiting_response / under_review /
// escalated); any other value matches that exact status.
function statusFilter(status: (typeof disputes.$inferSelect)["status"] | undefined) {
  if (!status) return undefined;
  if (status === "open") return notInArray(disputes.status, ["resolved", "withdrawn"]);
  return eq(disputes.status, status);
}
