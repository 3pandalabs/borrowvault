import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import type { PartyInfo } from "../booking/view.js";
import {
  activeBookingId,
  adminReadable,
  canSend,
  MESSAGES_PAGE_DEFAULT,
  MESSAGES_PAGE_MAX,
  messageBody,
  pageOf,
  preview,
  reportReason,
} from "../chat/rules.js";
import { notifyNewMessage } from "../chat/push.js";
import * as store from "../chat/store.js";
import { approvedMembership, isSocietyAdmin, requireSocietyAdmin, sharesUnitWithParty } from "../lib/authz.js";
import * as blocks from "../lib/blocks.js";
import { DomainError, forbidden, invalid, notFound } from "../lib/errors.js";
import { notifySocietyAdmins } from "../lib/notify.js";
import { clientKey, registerRateLimit } from "../plugins/rateLimit.js";

// Lender <-> borrower chat (api/ROUTES.md "Chat"). One conversation per
// (listing, borrower); participants are the listing owner and that borrower.
// Delivery is polling, plus an Expo push to the other participant
// (chat/push.ts). Messages are immutable: there is deliberately no edit or
// delete route (dispute evidence), and a DB trigger enforces it too.

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Rate-limit per signed-in user (authPlugin sets req.userId in onRequest, before the limiter). */
const perUser = (req: FastifyRequest) => (req.userId ? `user:${req.userId}` : clientKey(req));

type Role = "owner" | "borrower" | "admin";

/** Arbiter-style admin eligibility: society/platform admin, not a party, not living in a party's unit. */
async function eligibleAdmin(userId: string, c: store.ConversationRow): Promise<boolean> {
  if (userId === c.ownerId || userId === c.borrowerId) return false;
  if (!(await isSocietyAdmin(userId, c.societyId))) return false;
  return !(await sharesUnitWithParty(userId, { societyId: c.societyId, lenderId: c.ownerId, borrowerId: c.borrowerId }));
}

/**
 * Participant, or an eligible admin while a booking between the two is
 * DISPUTED/RESOLVED (read-only). Everyone else: 404.
 */
async function access(id: string, userId: string): Promise<{ c: store.ConversationRow; role: Role; bookings: store.BookingBetween[] }> {
  const c = await store.findConversation(id);
  if (!c) throw notFound();
  const bookings = await store.bookingsBetween(c.listingId, c.borrowerId);
  if (c.ownerId === userId) return { c, role: "owner", bookings };
  if (c.borrowerId === userId) return { c, role: "borrower", bookings };
  if (adminReadable(bookings) && (await eligibleAdmin(userId, c))) return { c, role: "admin", bookings };
  throw notFound();
}

function participantSide(role: Role): store.Side {
  if (role === "admin") throw forbidden("participants_only");
  return role;
}

async function sendAllowed(c: store.ConversationRow, role: Role, bookings: store.BookingBetween[], userId: string, listingStatus?: string) {
  if (role === "admin") return false;
  if (await blocks.blockedEitherWay(c.ownerId, c.borrowerId)) return false;
  const status = listingStatus ?? (await store.findListing(c.listingId))?.status ?? "archived";
  const member = Boolean(await approvedMembership(userId, c.societyId));
  return canSend({ role, listingStatus: status, senderApprovedMember: member, bookings, now: Date.now() });
}

async function conversationView(c: store.ConversationRow, role: Role, bookings: store.BookingBetween[], userId: string) {
  const l = await store.findListing(c.listingId);
  const other = c.ownerId === userId ? c.borrowerId : c.ownerId;
  const [parties, cover, unread, writable, blockedByMe] = await Promise.all([
    store.partyInfos(c.societyId, [c.ownerId, c.borrowerId]),
    l ? store.coverUrl(l) : Promise.resolve(null),
    role === "admin" ? Promise.resolve(0) : store.unreadFor(c.id, userId),
    sendAllowed(c, role, bookings, userId, l?.status ?? "archived"),
    role === "admin" ? Promise.resolve(false) : blocks.hasBlocked(userId, other),
  ]);
  return {
    id: c.id,
    societyId: c.societyId,
    listing: { id: c.listingId, title: l?.title ?? "", status: l?.status ?? "archived", coverUrl: cover },
    owner: parties.get(c.ownerId)!,
    borrower: parties.get(c.borrowerId)!,
    myRole: role,
    canSend: writable,
    blockedByMe,
    unreadCount: unread,
    activeBookingId: activeBookingId(bookings),
    bookings: bookings.map((b) => ({
      id: b.id,
      state: b.state,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
    })),
    createdAt: c.createdAt.toISOString(),
    lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
  };
}

async function reportViews(rows: { r: store.ReportRow; c: store.ConversationRow }[]) {
  if (!rows.length) return [];
  const msgs = await store.findMessagesByIds(rows.map((x) => x.r.messageId));
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const listingTitles = new Map<string, string>();
  for (const id of new Set(rows.map((x) => x.c.listingId))) listingTitles.set(id, (await store.findListing(id))?.title ?? "");
  const societyId = rows[0].c.societyId; // all rows come from one society
  const [parties, reporters] = await Promise.all([
    store.partyInfos(societyId, rows.flatMap((x) => [x.c.ownerId, x.c.borrowerId])),
    store.userNames(rows.map((x) => x.r.reporterId)),
  ]);
  return Promise.all(
    rows.map(async ({ r, c }) => {
      const m = byId.get(r.messageId)!;
      return {
        id: r.id,
        status: r.status as "open" | "reviewed",
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
        reviewNote: r.reviewNote,
        reporter: { id: r.reporterId, displayName: reporters.get(r.reporterId) ?? "" },
        conversation: {
          id: c.id,
          listing: { id: c.listingId, title: listingTitles.get(c.listingId) ?? "" },
          owner: parties.get(c.ownerId)!,
          borrower: parties.get(c.borrowerId)!,
        },
        message: store.messageView(m),
        context: (await store.reportContext(m)).map(store.messageView),
      };
    }),
  );
}

export async function chatRoutes(fastify: FastifyInstance) {
  await registerRateLimit(fastify);
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // --- conversations --------------------------------------------------------

  app.post(
    "/conversations",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 20, timeWindow: HOUR, keyGenerator: perUser } },
      schema: { body: z.object({ listingId: uuid }) },
    },
    async (req, reply) => {
      const me = req.userId!;
      const l = await store.findListing(req.body.listingId);
      if (!l) throw notFound();
      // The owner already sees their own listing, so a 403 leaks nothing.
      if (l.ownerId === me) throw forbidden("cannot_message_own_listing");
      const existing = await store.findConversationFor(l.id, me);
      if (!existing) {
        if (!(await approvedMembership(me, l.societyId))) throw notFound();
        if (l.status === "archived" || l.status === "removed") throw notFound();
        if (await blocks.blockedEitherWay(me, l.ownerId)) throw forbidden("blocked");
      }
      const { row, created } = existing ? { row: existing, created: false } : await store.getOrCreateConversation(l, me);
      const bookings = await store.bookingsBetween(row.listingId, row.borrowerId);
      return reply.code(created ? 201 : 200).send(await conversationView(row, "borrower", bookings, me));
    },
  );

  app.post(
    "/bookings/:id/conversation",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 20, timeWindow: HOUR, keyGenerator: perUser } },
      schema: { params: idParams },
    },
    async (req, reply) => {
      const me = req.userId!;
      const b = await store.findBooking(req.params.id);
      if (!b || (b.lenderId !== me && b.borrowerId !== me)) throw notFound();
      const l = await store.findListing(b.listingId);
      if (!l) throw notFound();
      if (!(await store.findConversationFor(l.id, b.borrowerId)) && (await blocks.blockedEitherWay(b.lenderId, b.borrowerId))) {
        throw forbidden("blocked");
      }
      const { row, created } = await store.getOrCreateConversation(l, b.borrowerId);
      const bookings = await store.bookingsBetween(row.listingId, row.borrowerId);
      const role: Role = row.ownerId === me ? "owner" : "borrower";
      return reply.code(created ? 201 : 200).send(await conversationView(row, role, bookings, me));
    },
  );

  app.get("/conversations", { preHandler: requireAuth }, async (req) => {
    const me = req.userId!;
    const { rows, lastByConv, listingsById, bookings } = await store.listMine(me);
    // PartyInfo labels are per society.
    const bySociety = new Map<string, string[]>();
    for (const { c } of rows) bySociety.set(c.societyId, [...(bySociety.get(c.societyId) ?? []), c.ownerId === me ? c.borrowerId : c.ownerId]);
    const parties = new Map<string, Map<string, PartyInfo>>();
    for (const [sid, ids] of bySociety) parties.set(sid, await store.partyInfos(sid, ids));
    return Promise.all(
      rows.map(async ({ c, unread }) => {
        const l = listingsById.get(c.listingId);
        const last = lastByConv.get(c.id);
        const otherId = c.ownerId === me ? c.borrowerId : c.ownerId;
        const pair = bookings.filter((b) => b.listingId === c.listingId && b.borrowerId === c.borrowerId);
        return {
          id: c.id,
          societyId: c.societyId,
          listing: { id: c.listingId, title: l?.title ?? "", status: l?.status ?? "archived", coverUrl: l ? await store.coverUrl(l) : null },
          other: parties.get(c.societyId)!.get(otherId)!,
          myRole: c.ownerId === me ? "owner" : "borrower",
          lastMessage: last
            ? { id: last.id, senderId: last.senderId, body: preview(last.body), createdAt: last.createdAt.toISOString() }
            : null,
          lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
          unreadCount: Number(unread),
          activeBookingId: activeBookingId(pair),
        };
      }),
    );
  });

  // Static path: registered alongside /conversations/:id; find-my-way prefers static segments.
  app.get("/conversations/unread", { preHandler: requireAuth }, async (req) => {
    const byConversation = await store.unreadCounts(req.userId!);
    const total = Object.values(byConversation).reduce((a, b) => a + b, 0);
    return { total, byConversation };
  });

  app.get("/conversations/:id", { preHandler: requireAuth, schema: { params: idParams } }, async (req) => {
    const { c, role, bookings } = await access(req.params.id, req.userId!);
    return conversationView(c, role, bookings, req.userId!);
  });

  // --- messages -------------------------------------------------------------

  app.get(
    "/conversations/:id/messages",
    {
      preHandler: requireAuth,
      schema: {
        params: idParams,
        querystring: z.object({
          after: uuid.optional(),
          before: uuid.optional(),
          limit: z.coerce.number().int().min(1).max(MESSAGES_PAGE_MAX).default(MESSAGES_PAGE_DEFAULT),
        }),
      },
    },
    async (req) => {
      const { c } = await access(req.params.id, req.userId!);
      const { after, before, limit } = req.query;
      if (after && before) throw invalid("use either after or before, not both");
      const cursor = after ?? before;
      const seq = cursor ? await store.seqOf(c.id, cursor) : null;
      if (cursor && seq === null) throw invalid("invalid_cursor");
      const direction = after ? "newer" : "older";
      const rows = await store.fetchMessages(c.id, {
        ...(after ? { afterSeq: seq! } : {}),
        ...(before ? { beforeSeq: seq! } : {}),
        limit,
      });
      const { rows: page, hasMore } = pageOf(rows, limit, direction);
      return { messages: page.map(store.messageView), hasMore };
    },
  );

  app.post(
    "/conversations/:id/messages",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 30, timeWindow: MINUTE, keyGenerator: perUser } },
      schema: { params: idParams, body: z.object({ body: z.string() }) },
    },
    async (req, reply) => {
      const me = req.userId!;
      const { c, role, bookings } = await access(req.params.id, me);
      const side = participantSide(role);
      const parsed = messageBody.safeParse(req.body.body);
      if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "invalid message");
      if (await blocks.blockedEitherWay(c.ownerId, c.borrowerId)) throw forbidden("blocked");
      if (!(await sendAllowed(c, role, bookings, me))) throw new DomainError("CONFLICT", "conversation_closed");
      const m = await store.insertMessage(c.id, me, side, parsed.data);
      // Fire-and-forget: a push failure (even a synchronous throw) never touches the 201.
      void Promise.resolve()
        .then(() => notifyNewMessage(c, m))
        .catch((err) => req.log.warn({ err }, "chat push failed"));
      return reply.code(201).send(store.messageView(m));
    },
  );

  app.post(
    "/conversations/:id/read",
    {
      preHandler: requireAuth,
      schema: { params: idParams, body: z.object({ upToMessageId: uuid.optional() }).nullish() },
    },
    async (req, reply) => {
      const { c, role } = await access(req.params.id, req.userId!);
      const side = participantSide(role);
      const upTo = req.body?.upToMessageId;
      const seq = upTo ? await store.seqOf(c.id, upTo) : null;
      if (upTo && seq === null) throw invalid("invalid_cursor");
      await store.markRead(c.id, side, seq);
      return reply.code(204).send();
    },
  );

  // --- reports --------------------------------------------------------------

  app.post(
    "/messages/:id/report",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 20, timeWindow: HOUR, keyGenerator: perUser } },
      schema: { params: idParams, body: z.object({ reason: z.string() }) },
    },
    async (req, reply) => {
      const me = req.userId!;
      const found = await store.findMessage(req.params.id);
      if (!found) throw notFound();
      const { m, c } = found;
      if (c.ownerId !== me && c.borrowerId !== me) {
        // Eligible admins can see the message but only participants report.
        const bookings = await store.bookingsBetween(c.listingId, c.borrowerId);
        if (adminReadable(bookings) && (await eligibleAdmin(me, c))) throw forbidden("participants_only");
        throw notFound();
      }
      if (m.senderId === me) throw forbidden("cannot_report_own_message");
      const parsed = reportReason.safeParse(req.body.reason);
      if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "invalid reason");
      const r = await store.insertReport(m, c, me, parsed.data);
      if (!r) throw new DomainError("CONFLICT", "already_reported");
      void notifySocietyAdmins(
        c.societyId,
        "A chat message was reported",
        "A resident reported a chat message. Review it in the society console.",
        `/admin/${c.societyId}/reports`,
      );
      return reply.code(201).send({ id: r.id, messageId: r.messageId, status: r.status, createdAt: r.createdAt.toISOString() });
    },
  );

  app.get(
    "/admin/societies/:id/message-reports",
    {
      preHandler: requireAuth,
      schema: { params: idParams, querystring: z.object({ status: z.enum(["open", "reviewed"]).default("open") }) },
    },
    async (req) => {
      const me = req.userId!;
      await requireSocietyAdmin(me, req.params.id);
      const rows = await store.listReports(req.params.id, req.query.status);
      const visible: typeof rows = [];
      for (const row of rows) if (await eligibleAdmin(me, row.c)) visible.push(row);
      return reportViews(visible);
    },
  );

  app.post(
    "/admin/message-reports/:id/review",
    {
      preHandler: requireAuth,
      schema: { params: idParams, body: z.object({ note: z.string().trim().max(1000).optional() }).nullish() },
    },
    async (req) => {
      const me = req.userId!;
      const found = await store.findReport(req.params.id);
      if (!found) throw notFound();
      await requireSocietyAdmin(me, found.c.societyId);
      if (!(await eligibleAdmin(me, found.c))) throw notFound();
      const r = await store.reviewReport(found.r.id, me, req.body?.note || null);
      const [view] = await reportViews([{ r, c: found.c }]);
      return view;
    },
  );
}
