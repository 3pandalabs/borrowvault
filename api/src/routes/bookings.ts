import { and, desc, eq, or } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { finalizeMedia, presignMedia } from "../booking/evidence.js";
import * as svc from "../booking/service.js";
import { BOOKING_STATES } from "../booking/states.js";
import { bookingDetail, bookingSummaries } from "../booking/view.js";
import { db } from "../db/index.js";
import { bookings } from "../db/schema.js";
import { isSocietyAdmin } from "../lib/authz.js";
import { notFound } from "../lib/errors.js";
import { signalBooking, startBookingWorkflow, updateBooking, type HttpFailure } from "../temporal/runWorkflow.js";

// Booking routes. Reads and non-state-changing actions run inline. Every action
// that can change booking.state runs as an UPDATE on the booking's Temporal
// workflow (`booking-<id>`), so the HTTP caller gets the activity's result
// synchronously and the workflow sees every state change.

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });

const geo = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().max(5000),
  capturedAt: z.string().datetime(),
});

const checklistAnswers = z.record(
  z.string().max(40),
  z.object({
    ok: z.boolean().optional(),
    value: z.union([z.string().max(200), z.number()]).optional(),
    note: z.string().max(500).optional(),
  }),
);

/** Party, or a society/platform admin once the booking is disputed. Everyone else: 404. */
async function bookingForCaller(id: string, userId: string): Promise<svc.Booking> {
  const b = await svc.loadBooking(id);
  if (b.lenderId === userId || b.borrowerId === userId) return b;
  if ((b.state === "DISPUTED" || b.state === "RESOLVED") && (await isSocietyAdmin(userId, b.societyId))) return b;
  throw notFound();
}

async function detail(id: string, userId: string) {
  return bookingDetail(await svc.loadBooking(id), userId);
}

/** Runs a workflow update and replies with the fresh BookingDetail (or the mapped error). */
async function viaWorkflow(
  reply: FastifyReply,
  bookingId: string,
  userId: string,
  update: string,
  input: Record<string, unknown>,
  pick?: (d: Awaited<ReturnType<typeof detail>>) => unknown,
) {
  try {
    await updateBooking(bookingId, update, { ...input, actorId: userId });
  } catch (err) {
    const { status, body } = err as HttpFailure;
    return reply.code(status ?? 500).send(body ?? { error: "internal_error" });
  }
  const d = await detail(bookingId, userId);
  return reply.send(pick ? pick(d) : d);
}

export async function bookingRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/bookings",
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({
          listingId: uuid,
          startsAt: z.string().datetime({ offset: true }),
          endsAt: z.string().datetime({ offset: true }),
          pricing: z.enum(["hourly", "daily", "weekend"]),
        }),
      },
    },
    async (req, reply) => {
      const b = await svc.createBooking({ borrowerId: req.userId!, ...req.body });
      try {
        await startBookingWorkflow(b);
      } catch (err) {
        req.log.error({ err, bookingId: b.id }, "could not start bookingWorkflow");
        await svc.abandonBooking(b.id);
        return reply.code(503).send({ error: "booking service unavailable, try again", code: "UNAVAILABLE" });
      }
      await svc.notifyRequested(b.id);
      const [summary] = await bookingSummaries([b], req.userId!);
      return reply.code(201).send(summary);
    },
  );

  app.get(
    "/bookings",
    {
      preHandler: requireAuth,
      schema: {
        querystring: z.object({
          role: z.enum(["lender", "borrower"]).optional(),
          state: z.enum(BOOKING_STATES).optional(),
        }),
      },
    },
    async (req) => {
      const me = req.userId!;
      const who =
        req.query.role === "lender"
          ? eq(bookings.lenderId, me)
          : req.query.role === "borrower"
            ? eq(bookings.borrowerId, me)
            : or(eq(bookings.lenderId, me), eq(bookings.borrowerId, me));
      const rows = await db
        .select()
        .from(bookings)
        .where(and(who, req.query.state ? eq(bookings.state, req.query.state) : undefined))
        .orderBy(desc(bookings.startsAt))
        .limit(200);
      return bookingSummaries(rows, me);
    },
  );

  app.get("/bookings/:id", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    const b = await bookingForCaller(req.params.id, req.userId!);
    return bookingDetail(b, req.userId!);
  });

  // --- lender decisions / cancel (workflow updates) ---

  for (const [path, update] of [
    ["accept", "accept"],
    ["decline", "decline"],
    ["cancel", "cancel"],
    ["payment/confirm", "confirmPayment"],
    ["disputes/accept-offer", "acceptOffer"],
  ] as const) {
    app.post(`/bookings/:id/${path}`, { preHandler: requireAuth, schema: { params: idParams } }, async (req, reply) => {
      const b = await bookingForCaller(req.params.id, req.userId!);
      return viaWorkflow(reply, b.id, req.userId!, update, {});
    });
  }

  // --- payment claim (inline: no state change) ---

  app.post(
    "/bookings/:id/payment/claim",
    { preHandler: requireAuth, schema: { params: idParams, body: z.object({ utr: z.string().trim().max(40).optional() }).optional() } },
    async (req) => {
      const b = await bookingForCaller(req.params.id, req.userId!);
      await svc.claimPayment({ bookingId: b.id, actorId: req.userId!, utr: req.body?.utr });
      return detail(b.id, req.userId!);
    },
  );

  // --- evidence (inline: presign -> client PUT -> finalize re-hash) ---

  app.post(
    "/bookings/:id/media/presign",
    {
      preHandler: requireAuth,
      schema: {
        params: idParams,
        body: z.object({
          phase: z.enum(["handover", "return", "dispute"]),
          slot: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/), // dispute slots are free-form, e.g. "dispute-1"
          mime: z.enum(["image/jpeg", "image/png", "video/mp4", "video/quicktime"]), // png: dispute phase only
          bytes: z.number().int().positive(),
          sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
          geo: geo.nullable().optional(), // null/absent = no GPS fix (flagged, never rejected)
        }),
      },
    },
    async (req, reply) => {
      const b = await bookingForCaller(req.params.id, req.userId!);
      return reply.code(201).send(await presignMedia({ bookingId: b.id, userId: req.userId!, ...req.body }));
    },
  );

  app.post(
    "/bookings/:id/media/:mediaId/finalize",
    { preHandler: requireAuth, schema: { params: z.object({ id: uuid, mediaId: uuid }) } },
    async (req) => {
      const b = await bookingForCaller(req.params.id, req.userId!);
      return finalizeMedia({ bookingId: b.id, mediaId: req.params.mediaId, userId: req.userId! });
    },
  );

  // --- inspections (workflow updates) ---

  app.post(
    "/bookings/:id/inspections",
    {
      preHandler: requireAuth,
      schema: {
        params: idParams,
        body: z.object({
          phase: z.enum(["handover", "return"]),
          mediaIds: z.array(uuid).max(30),
          checklistAnswers,
          geo: geo.nullable(), // null = no GPS fix (flagged, never rejected)
        }),
      },
    },
    async (req, reply) => {
      const b = await bookingForCaller(req.params.id, req.userId!);
      const party = b.lenderId === req.userId ? "lender" : "borrower";
      return viaWorkflow(reply, b.id, req.userId!, "submitInspection", req.body, (d) =>
        d.inspections.find((x) => x.phase === req.body.phase && x.party === party),
      );
    },
  );

  app.post(
    "/bookings/:id/inspections/ack",
    {
      preHandler: requireAuth,
      schema: {
        params: idParams,
        body: z.object({
          phase: z.enum(["handover", "return"]),
          result: z.enum(["agreed", "objected"]),
          note: z.string().max(1000).optional(),
          mediaIds: z.array(uuid).max(5).optional(), // objection photos (slot "objection")
        }),
      },
    },
    async (req, reply) => {
      const b = await bookingForCaller(req.params.id, req.userId!);
      return viaWorkflow(reply, b.id, req.userId!, "ackInspection", req.body);
    },
  );

  // --- disputes ---

  app.post(
    "/bookings/:id/disputes",
    {
      preHandler: requireAuth,
      schema: {
        params: idParams,
        body: z.object({
          category: z.enum(["damage", "missing_part", "not_returned", "not_as_described", "late"]),
          description: z.string().trim().min(10).max(2000),
          claimedPaise: z.number().int().nonnegative(),
          mediaIds: z.array(uuid).max(10).default([]),
        }),
      },
    },
    async (req, reply) => {
      const b = await bookingForCaller(req.params.id, req.userId!);
      return viaWorkflow(reply, b.id, req.userId!, "raiseDispute", req.body);
    },
  );

  app.post(
    "/bookings/:id/disputes/respond",
    {
      preHandler: requireAuth,
      schema: {
        params: idParams,
        body: z.object({
          responseText: z.string().trim().min(1).max(2000),
          offerPaise: z.number().int().nonnegative().optional(),
        }),
      },
    },
    async (req) => {
      const b = await bookingForCaller(req.params.id, req.userId!);
      await svc.respondDispute({ bookingId: b.id, actorId: req.userId!, ...req.body });
      return detail(b.id, req.userId!);
    },
  );

  app.post(
    "/bookings/:id/disputes/ruling",
    {
      preHandler: requireAuth,
      schema: {
        params: idParams,
        body: z.object({ awardPaise: z.number().int().nonnegative(), note: z.string().trim().min(5).max(2000) }),
      },
    },
    async (req, reply) => {
      const b = await bookingForCaller(req.params.id, req.userId!);
      return viaWorkflow(reply, b.id, req.userId!, "ruling", req.body);
    },
  );

  // --- settlement after COMPLETED / RESOLVED (inline) ---

  app.post("/bookings/:id/deposit/refund-claim", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    const b = await bookingForCaller(req.params.id, req.userId!);
    await svc.refundClaim({ bookingId: b.id, actorId: req.userId! });
    return detail(b.id, req.userId!);
  });

  app.post("/bookings/:id/deposit/refund-confirm", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    const b = await bookingForCaller(req.params.id, req.userId!);
    await svc.refundConfirm({ bookingId: b.id, actorId: req.userId! });
    // Stops the 24 h p2p refund timer. Best-effort: the timer's activity re-checks the DB anyway.
    await signalBooking(b.id, "refundConfirmed", (m) => req.log.warn(m));
    return detail(b.id, req.userId!);
  });

  app.post("/bookings/:id/award/paid-claim", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    const b = await bookingForCaller(req.params.id, req.userId!);
    await svc.awardPaidClaim({ bookingId: b.id, actorId: req.userId! });
    return detail(b.id, req.userId!);
  });

  app.post("/bookings/:id/award/paid-confirm", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    const b = await bookingForCaller(req.params.id, req.userId!);
    await svc.awardPaidConfirm({ bookingId: b.id, actorId: req.userId! });
    return detail(b.id, req.userId!);
  });

  app.post(
    "/bookings/:id/ratings",
    {
      preHandler: requireAuth,
      schema: {
        params: idParams,
        body: z.object({
          stars: z.number().int().min(1).max(5),
          punctual: z.boolean().optional(),
          careful: z.boolean().optional(),
          asDescribed: z.boolean().optional(),
          comment: z.string().max(1000).optional(),
        }),
      },
    },
    async (req, reply) => {
      const b = await bookingForCaller(req.params.id, req.userId!);
      const r = await svc.rate({ bookingId: b.id, actorId: req.userId!, ...req.body });
      return reply.code(201).send({
        id: r.id,
        bookingId: r.bookingId,
        rateeId: r.rateeId,
        stars: r.stars,
        punctual: r.punctual,
        careful: r.careful,
        asDescribed: r.asDescribed,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
      });
    },
  );
}
