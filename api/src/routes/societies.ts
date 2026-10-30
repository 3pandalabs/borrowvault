import { and, asc, eq, gt, ilike, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { db } from "../db/index.js";
import { bookings, inviteCodes, listings, memberships, societies, towers, units, users } from "../db/schema.js";
import { approvedSocietyIds, isPlatformAdmin, isSocietyAdmin } from "../lib/authz.js";
import { conflict, invalid, notFound } from "../lib/errors.js";
import { UPI_VPA_RE } from "../lib/upi.js";
import { membershipById, membershipsOf, userView } from "../lib/users.js";
import { listingPhotoKey, parseKey, presignDownload, presignUpload, proofKey } from "../plugins/r2.js";
import { phoneSchema } from "./auth.js";

const uuid = z.string().uuid();

export async function societyRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // --- profile -------------------------------------------------------------

  app.get("/me", { preHandler: requireAuth }, async (req) => {
    const [u] = await db.select().from(users).where(eq(users.id, req.userId!)).limit(1);
    if (!u) throw notFound();
    return { user: userView(u), memberships: await membershipsOf(u.id) };
  });

  app.patch(
    "/me",
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({
          displayName: z.string().trim().min(1).max(120).optional(),
          phone: phoneSchema.optional(),
          upiVpa: z.string().regex(UPI_VPA_RE, "invalid UPI ID").nullable().optional(),
        }),
      },
    },
    async (req) => {
      const patch = req.body;
      const [u] = await db
        .update(users)
        .set({
          ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.upiVpa !== undefined ? { upiVpa: patch.upiVpa } : {}),
        })
        .where(eq(users.id, req.userId!))
        .returning();
      if (!u) throw notFound();
      return { user: userView(u) };
    },
  );

  // --- public society lookup -------------------------------------------------

  app.get("/societies", { schema: { querystring: z.object({ q: z.string().max(100).optional() }) } }, async (req) => {
    const q = req.query.q?.trim();
    const rows = await db
      .select({ id: societies.id, name: societies.name, city: societies.city })
      .from(societies)
      .where(and(eq(societies.status, "live"), q ? ilike(societies.name, `%${q.replace(/[%_\\]/g, "\\$&")}%`) : undefined))
      .orderBy(asc(societies.name))
      .limit(50);
    return rows;
  });

  app.get("/societies/:id/towers", { schema: { params: z.object({ id: uuid }) } }, async (req) => {
    const [s] = await db.select({ id: societies.id }).from(societies).where(and(eq(societies.id, req.params.id), eq(societies.status, "live")));
    if (!s) throw notFound();
    return db.select({ id: towers.id, name: towers.name }).from(towers).where(eq(towers.societyId, s.id)).orderBy(asc(towers.name));
  });

  app.post(
    "/societies/:id/join",
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: uuid }),
        body: z.object({
          inviteCode: z.string().trim().max(32).optional(),
          towerId: uuid,
          flatNo: z.string().trim().min(1).max(20),
          occupancy: z.enum(["owner", "tenant", "family"]),
          proofKey: z.string().max(300).optional(),
        }),
      },
    },
    async (req, reply) => {
      const societyId = req.params.id;
      const b = req.body;
      const [s] = await db.select().from(societies).where(and(eq(societies.id, societyId), eq(societies.status, "live")));
      if (!s) throw notFound();
      const [t] = await db.select().from(towers).where(and(eq(towers.id, b.towerId), eq(towers.societyId, societyId)));
      if (!t) throw invalid("unknown tower");
      if (b.proofKey) {
        const pk = parseKey(b.proofKey);
        if (!pk || pk.kind !== "proof" || pk.userId !== req.userId) throw invalid("invalid proofKey");
      }

      let via = "request";
      let inviteCodeId: string | null = null;
      if (b.inviteCode) {
        const [code] = await db
          .select()
          .from(inviteCodes)
          .where(
            and(
              eq(inviteCodes.code, b.inviteCode.toUpperCase()),
              eq(inviteCodes.societyId, societyId),
              eq(inviteCodes.towerId, t.id),
              gt(inviteCodes.expiresAt, new Date()),
            ),
          );
        if (!code) throw invalid("invite code is invalid or expired for this tower");
        via = "invite";
        inviteCodeId = code.id;
      }

      const id = await db.transaction(async (tx) => {
        const flatNo = b.flatNo.toUpperCase();
        await tx.insert(units).values({ towerId: t.id, flatNo }).onConflictDoNothing();
        const [unit] = await tx.select().from(units).where(and(eq(units.towerId, t.id), eq(units.flatNo, flatNo)));

        const [existing] = await tx
          .select()
          .from(memberships)
          .where(and(eq(memberships.userId, req.userId!), eq(memberships.societyId, societyId)));
        if (existing && (existing.status === "pending" || existing.status === "approved")) {
          throw conflict(`you already have a ${existing.status} membership in this society`);
        }
        const values = {
          unitId: unit.id,
          occupancy: b.occupancy,
          via,
          inviteCodeId,
          proofKey: b.proofKey ?? null,
          status: "pending" as const,
          role: "resident" as const, // re-joining after a revoke never restores admin rights
          reviewNote: null,
          approvedBy: null,
          approvedAt: null,
        };
        if (existing) {
          // Re-apply after a rejection/revocation.
          await tx.update(memberships).set(values).where(eq(memberships.id, existing.id));
          return existing.id;
        }
        const [m] = await tx
          .insert(memberships)
          .values({ userId: req.userId!, societyId, ...values })
          .returning({ id: memberships.id });
        return m.id;
      });
      return reply.code(201).send(await membershipById(id));
    },
  );

  // --- storage (proofs, listing photos). Evidence uses /bookings/:id/media/* ---

  const PURPOSES = {
    proof: { mimes: ["application/pdf", "image/jpeg", "image/png"], max: 10 * 1024 * 1024 },
    listing_photo: { mimes: ["image/jpeg", "image/png", "image/webp"], max: 8 * 1024 * 1024 },
  } as const;

  app.post(
    "/storage/presign",
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({
          purpose: z.enum(["proof", "listing_photo"]),
          mime: z.string().max(100),
          bytes: z.number().int().positive(),
        }),
      },
    },
    async (req) => {
      const rule = PURPOSES[req.body.purpose];
      if (!(rule.mimes as readonly string[]).includes(req.body.mime)) throw invalid(`mime must be one of ${rule.mimes.join(", ")}`);
      if (req.body.bytes > rule.max) throw invalid(`file must be at most ${rule.max / 1024 / 1024} MB`);
      const key = req.body.purpose === "proof" ? proofKey(req.userId!, req.body.mime) : listingPhotoKey(req.userId!, req.body.mime);
      return { key, uploadUrl: await presignUpload(key, req.body.mime, req.body.bytes) };
    },
  );

  app.get(
    "/storage/url",
    { preHandler: requireAuth, schema: { querystring: z.object({ key: z.string().min(1).max(300) }) } },
    async (req) => {
      const key = req.query.key;
      const parsed = parseKey(key);
      if (!parsed) throw notFound();
      const me = req.userId!;
      let allowed = parsed.userId === me;

      if (!allowed && parsed.kind === "proof") {
        const rows = await db.select({ societyId: memberships.societyId }).from(memberships).where(eq(memberships.proofKey, key));
        for (const r of rows) if (await isSocietyAdmin(me, r.societyId)) allowed = true;
      } else if (!allowed && parsed.kind === "listing") {
        const mine = await approvedSocietyIds(me);
        if (mine.length) {
          const rows = await db
            .select({ societyId: listings.societyId })
            .from(listings)
            .where(sql`${listings.photoKeys} @> ${JSON.stringify([key])}::jsonb`);
          allowed = rows.some((r) => mine.includes(r.societyId));
        }
      } else if (!allowed && parsed.kind === "evidence") {
        const [b] = await db.select().from(bookings).where(eq(bookings.id, parsed.bookingId));
        if (b) {
          allowed =
            b.lenderId === me ||
            b.borrowerId === me ||
            ((b.state === "DISPUTED" || b.state === "RESOLVED") && (await isSocietyAdmin(me, b.societyId))) ||
            (await isPlatformAdmin(me));
        }
      }
      if (!allowed) throw notFound();
      return { url: await presignDownload(key) };
    },
  );
}
