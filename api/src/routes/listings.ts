import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { OCCUPYING_STATES } from "../booking/states.js";
import { trustOf } from "../booking/view.js";
import { db } from "../db/index.js";
import { bookings, listings, users, type ChecklistItem } from "../db/schema.js";
import { approvedMembership, approvedSocietyIds, requireApprovedMember, unitLabels } from "../lib/authz.js";
import { CATEGORIES, CATEGORY_BY_KEY } from "../lib/categories.js";
import { forbidden, invalid, notFound } from "../lib/errors.js";
import { parseKey, presignDownload } from "../plugins/r2.js";

const uuid = z.string().uuid();
const paise = z.number().int().nonnegative().max(100_000_000);

const checklistItem = z
  .object({
    id: z.string().regex(/^[a-z0-9_]{1,40}$/),
    label: z.string().trim().min(1).max(120),
    type: z.enum(["bool", "percent", "choice", "count", "text"]),
    options: z.array(z.string().trim().min(1).max(40)).min(2).max(10).optional(),
  })
  .refine((c) => c.type !== "choice" || (c.options?.length ?? 0) >= 2, "choice items need options");

const listingFields = {
  kind: z.enum(["item", "skill"]),
  category: z.string().max(40),
  title: z.string().trim().min(3).max(120),
  description: z.string().max(4000).default(""),
  hourlyPaise: paise.nullable().optional(),
  dailyPaise: paise.nullable().optional(),
  weekendPaise: paise.nullable().optional(),
  depositPaise: paise,
  replacementValuePaise: paise.nullable().optional(),
  checklistTemplate: z.array(checklistItem).max(30),
  requiredPhotoSlots: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(12),
  photoKeys: z.array(z.string().max(300)).max(10),
};

const createBody = z.object({ societyId: uuid, ...listingFields });
const patchBody = z
  .object({
    ...Object.fromEntries(Object.entries(listingFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])),
    status: z.enum(["active", "paused", "archived"]).optional(),
  })
  .partial() as z.ZodType<Partial<z.infer<typeof createBody>> & { status?: "active" | "paused" | "archived" }>;

type ListingRow = typeof listings.$inferSelect;
type ListingInput = Omit<z.infer<typeof createBody>, "societyId">;

/** Validates and normalises a full listing (after merging a PATCH). Throws 400. */
function normalise(l: ListingInput, ownerId: string): ListingInput {
  const preset = CATEGORY_BY_KEY.get(l.category);
  if (!preset) throw invalid(`unknown category; see GET /categories`);
  if (preset.kind !== l.kind) throw invalid(`category ${l.category} is for ${preset.kind} listings`);
  if (l.hourlyPaise == null && l.dailyPaise == null && l.weekendPaise == null) throw invalid("at least one price is required");
  for (const k of l.photoKeys) {
    const p = parseKey(k);
    if (!p || p.kind !== "listing" || p.userId !== ownerId) throw invalid("photoKeys must be your own listing photo uploads");
  }
  if (l.kind === "skill") {
    // Skills: no deposit, no handover inspection.
    return { ...l, depositPaise: 0, replacementValuePaise: null, checklistTemplate: [], requiredPhotoSlots: [] };
  }
  if (l.requiredPhotoSlots.length < 1) throw invalid("items need at least one required photo slot");
  if (new Set(l.checklistTemplate.map((c) => c.id)).size !== l.checklistTemplate.length) throw invalid("checklist ids must be unique");
  if (new Set(l.requiredPhotoSlots).size !== l.requiredPhotoSlots.length) throw invalid("photo slots must be unique");
  if (l.replacementValuePaise != null && l.depositPaise > l.replacementValuePaise) {
    throw invalid("deposit cannot exceed the replacement value");
  }
  return l;
}

async function owners(rows: ListingRow[]) {
  const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
  const us = ownerIds.length ? await db.select().from(users).where(inArray(users.id, ownerIds)) : [];
  const byId = new Map(us.map((u) => [u.id, u]));
  const labels = new Map<string, Awaited<ReturnType<typeof unitLabels>>>();
  for (const s of new Set(rows.map((r) => r.societyId))) {
    labels.set(s, await unitLabels(s, [...new Set(rows.filter((r) => r.societyId === s).map((r) => r.ownerId))]));
  }
  return (r: ListingRow) => {
    const u = byId.get(r.ownerId);
    const l = labels.get(r.societyId)?.get(r.ownerId);
    return {
      id: r.ownerId,
      displayName: u?.displayName ?? "",
      towerName: l?.towerName ?? null,
      flatNo: l?.flatNo ?? null,
      trust: u ? trustOf(u) : { score: 0, completed: 0, disputesLost: 0 },
    };
  };
}

async function summary(r: ListingRow, owner: ReturnType<Awaited<ReturnType<typeof owners>>>) {
  return {
    id: r.id,
    societyId: r.societyId,
    kind: r.kind,
    category: r.category,
    title: r.title,
    hourlyPaise: r.hourlyPaise,
    dailyPaise: r.dailyPaise,
    weekendPaise: r.weekendPaise,
    depositPaise: r.depositPaise,
    status: r.status,
    coverUrl: r.photoKeys[0] ? await presignDownload(r.photoKeys[0]) : null,
    owner,
  };
}

async function full(r: ListingRow) {
  const ownerOf = await owners([r]);
  const s = await summary(r, ownerOf(r));
  return {
    ...s,
    description: r.description,
    replacementValuePaise: r.replacementValuePaise,
    checklistTemplate: r.checklistTemplate,
    requiredPhotoSlots: r.requiredPhotoSlots,
    photoKeys: r.photoKeys,
    photoUrls: await Promise.all(r.photoKeys.map((k) => presignDownload(k))),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Listing visible to the caller (approved member of its society, or owner). 404 otherwise. */
async function visibleListing(id: string, userId: string): Promise<ListingRow> {
  const [l] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
  if (!l) throw notFound();
  if (l.ownerId !== userId) {
    await requireApprovedMember(userId, l.societyId);
    if (l.status === "archived") throw notFound();
  }
  return l;
}

export async function listingRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/categories", async () => CATEGORIES);

  app.get(
    "/listings",
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({
          societyId: uuid.optional(),
          kind: z.enum(["item", "skill"]).optional(),
          category: z.string().max(40).optional(),
          q: z.string().max(100).optional(),
          ownerId: z.literal("me").optional(), // my listings across societies, any status
        }),
      },
    },
    async (req) => {
      const me = req.userId!;
      const q = req.query;
      let societyIds: string[];
      if (q.societyId) {
        await requireApprovedMember(me, q.societyId);
        societyIds = [q.societyId];
      } else {
        societyIds = await approvedSocietyIds(me);
      }
      const term = q.q?.trim().replace(/[%_\\]/g, "\\$&");
      const where = q.ownerId === "me"
        ? and(eq(listings.ownerId, me), q.societyId ? eq(listings.societyId, q.societyId) : undefined)
        : societyIds.length
          ? and(inArray(listings.societyId, societyIds), eq(listings.status, "active"))
          : undefined;
      if (!where) return [];
      const rows = await db
        .select()
        .from(listings)
        .where(
          and(
            where,
            q.kind ? eq(listings.kind, q.kind) : undefined,
            q.category ? eq(listings.category, q.category) : undefined,
            term ? or(ilike(listings.title, `%${term}%`), ilike(listings.description, `%${term}%`)) : undefined,
          ),
        )
        .orderBy(desc(listings.createdAt))
        .limit(200);
      const ownerOf = await owners(rows);
      return Promise.all(rows.map((r) => summary(r, ownerOf(r))));
    },
  );

  app.get("/listings/:id", { preHandler: requireAuth, schema: { params: z.object({ id: uuid }) } }, async (req) =>
    full(await visibleListing(req.params.id, req.userId!)),
  );

  app.post("/listings", { preHandler: requireAuth, schema: { body: createBody } }, async (req, reply) => {
    const me = req.userId!;
    const { societyId, ...input } = req.body;
    await requireApprovedMember(me, societyId);
    const [u] = await db.select({ upiVpa: users.upiVpa }).from(users).where(eq(users.id, me));
    if (!u?.upiVpa) throw invalid("add your UPI ID to your profile before lending");
    const l = normalise(input, me);
    const [row] = await db
      .insert(listings)
      .values({
        societyId,
        ownerId: me,
        ...l,
        checklistTemplate: l.checklistTemplate as ChecklistItem[],
        hourlyPaise: l.hourlyPaise ?? null,
        dailyPaise: l.dailyPaise ?? null,
        weekendPaise: l.weekendPaise ?? null,
        replacementValuePaise: l.replacementValuePaise ?? null,
      })
      .returning();
    return reply.code(201).send(await full(row));
  });

  app.patch("/listings/:id", { preHandler: requireAuth, schema: { params: z.object({ id: uuid }), body: patchBody } }, async (req) => {
    const me = req.userId!;
    const current = await visibleListing(req.params.id, me);
    if (current.ownerId !== me) throw forbidden("only the owner can edit a listing");
    if (!(await approvedMembership(me, current.societyId))) throw notFound();
    const { status, ...patch } = req.body as Partial<z.infer<typeof createBody>> & { status?: "active" | "paused" | "archived" };
    delete (patch as { societyId?: string }).societyId;
    const merged = normalise(
      {
        kind: current.kind,
        category: current.category,
        title: current.title,
        description: current.description,
        hourlyPaise: current.hourlyPaise,
        dailyPaise: current.dailyPaise,
        weekendPaise: current.weekendPaise,
        depositPaise: current.depositPaise,
        replacementValuePaise: current.replacementValuePaise,
        checklistTemplate: current.checklistTemplate,
        requiredPhotoSlots: current.requiredPhotoSlots,
        photoKeys: current.photoKeys,
        ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
      } as ListingInput,
      me,
    );
    // Existing bookings keep their frozen checklist/slot snapshots.
    const [row] = await db
      .update(listings)
      .set({
        ...merged,
        checklistTemplate: merged.checklistTemplate as ChecklistItem[],
        hourlyPaise: merged.hourlyPaise ?? null,
        dailyPaise: merged.dailyPaise ?? null,
        weekendPaise: merged.weekendPaise ?? null,
        replacementValuePaise: merged.replacementValuePaise ?? null,
        ...(status ? { status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(listings.id, current.id))
      .returning();
    return full(row);
  });

  app.get(
    "/listings/:id/availability",
    {
      preHandler: requireAuth,
      schema: {
        params: z.object({ id: uuid }),
        querystring: z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }),
      },
    },
    async (req) => {
      const l = await visibleListing(req.params.id, req.userId!);
      const from = req.query.from ? new Date(req.query.from) : new Date();
      const to = req.query.to ? new Date(req.query.to) : new Date(from.getTime() + 90 * 24 * 3_600_000);
      if (!(to > from)) throw invalid("to must be after from");
      const rows = await db
        .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
        .from(bookings)
        .where(
          and(
            eq(bookings.listingId, l.id),
            inArray(bookings.state, [...OCCUPYING_STATES]),
            sql`tstzrange(${bookings.startsAt}, ${bookings.endsAt}) && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz)`,
          ),
        )
        .orderBy(asc(bookings.startsAt));
      return rows.map((r) => ({ startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString() }));
    },
  );
}
