import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  bookingEvents,
  bookingPayments,
  disputes,
  inspectionMedia,
  inspections,
  listings,
  ratings,
  societies,
  users,
} from "../db/schema.js";
import { unitLabels } from "../lib/authz.js";
import { presignDownload } from "../plugins/r2.js";
import { awardIntent, depositProvider, refundIntent } from "../payments/provider.js";
import { computeNextAction, type Role } from "./nextAction.js";
import type { Booking } from "./service.js";
import { TIMERS } from "./states.js";

// Serializers for the Booking / BookingDetail shapes in api/ROUTES.md.

export type Trust = { score: number; completed: number; disputesLost: number };
export type PartyInfo = { id: string; displayName: string; towerName: string | null; flatNo: string | null; trust: Trust };

export function trustOf(u: { trustScore: number; trustCompleted: number; trustDisputesLost: number }): Trust {
  return { score: u.trustScore, completed: u.trustCompleted, disputesLost: u.trustDisputesLost };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

type Payment = typeof bookingPayments.$inferSelect;
type Dispute = typeof disputes.$inferSelect;
type UserRow = typeof users.$inferSelect;

function disputeDeadline(d: Dispute): Date | null {
  if (d.status === "resolved" || d.status === "withdrawn" || d.escalatedAt) return null;
  return new Date(d.createdAt.getTime() + TIMERS.disputeEscalateMs);
}

async function loadContext(rows: Booking[], callerId: string) {
  const ids = rows.map((b) => b.id);
  const listingIds = [...new Set(rows.map((b) => b.listingId))];
  const userIds = [...new Set(rows.flatMap((b) => [b.lenderId, b.borrowerId]))];
  const [ls, us, ps, ins, ds, rs] = ids.length
    ? await Promise.all([
        db
          .select({ id: listings.id, title: listings.title, kind: listings.kind, category: listings.category })
          .from(listings)
          .where(inArray(listings.id, listingIds)),
        db.select().from(users).where(inArray(users.id, userIds)),
        db.select().from(bookingPayments).where(inArray(bookingPayments.bookingId, ids)),
        db.select().from(inspections).where(inArray(inspections.bookingId, ids)),
        db.select().from(disputes).where(inArray(disputes.bookingId, ids)),
        db
          .select({ bookingId: ratings.bookingId })
          .from(ratings)
          .where(and(inArray(ratings.bookingId, ids), eq(ratings.raterId, callerId))),
      ])
    : [[], [], [], [], [], []];

  const labels = new Map<string, Map<string, { towerName: string | null; flatNo: string | null }>>();
  for (const societyId of new Set(rows.map((b) => b.societyId))) {
    const sUsers = [...new Set(rows.filter((b) => b.societyId === societyId).flatMap((b) => [b.lenderId, b.borrowerId]))];
    labels.set(societyId, await unitLabels(societyId, sUsers));
  }

  return {
    listing: new Map(ls.map((l) => [l.id, l])),
    user: new Map(us.map((u) => [u.id, u])),
    payment: new Map(ps.map((p) => [p.bookingId, p])),
    inspections: ins,
    dispute: new Map(ds.map((d) => [d.bookingId, d])),
    rated: new Set(rs.map((r) => r.bookingId)),
    labels,
  };
}

type Ctx = Awaited<ReturnType<typeof loadContext>>;

function party(ctx: Ctx, societyId: string, userId: string): PartyInfo {
  const u = ctx.user.get(userId) as UserRow;
  const l = ctx.labels.get(societyId)?.get(userId);
  return {
    id: userId,
    displayName: u?.displayName ?? "",
    towerName: l?.towerName ?? null,
    flatNo: l?.flatNo ?? null,
    trust: u ? trustOf(u) : { score: 0, completed: 0, disputesLost: 0 },
  };
}

function roleOf(b: Booking, callerId: string): Role {
  return b.lenderId === callerId ? "lender" : b.borrowerId === callerId ? "borrower" : "admin";
}

function summarize(b: Booking, ctx: Ctx, callerId: string) {
  const role = roleOf(b, callerId);
  const p = ctx.payment.get(b.id) ?? null;
  const d = ctx.dispute.get(b.id) ?? null;
  const awardPayerRole = p?.awardPayerId ? (p.awardPayerId === b.lenderId ? "lender" : "borrower") : null;
  const { nextAction, deadlineAt } = computeNextAction({
    state: b.state,
    role,
    stateChangedAt: b.stateChangedAt,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    inspections: ctx.inspections
      .filter((x) => x.bookingId === b.id)
      .map((x) => ({ phase: x.phase, party: x.party, ackResult: x.ackResult })),
    dispute: d
      ? {
          raisedByRole: d.raisedBy === b.lenderId ? "lender" : "borrower",
          responded: Boolean(d.respondedAt),
          createdAt: d.createdAt,
          escalated: Boolean(d.escalatedAt),
          resolved: d.status === "resolved",
        }
      : null,
    payment: p
      ? {
          depositMode: p.depositMode,
          claimedAt: p.claimedAt,
          refundDuePaise: p.refundDuePaise,
          refundClaimedAt: p.refundClaimedAt,
          refundConfirmedAt: p.refundConfirmedAt,
          awardStatus: p.awardStatus,
          awardPayerRole,
        }
      : null,
    ratedByMe: ctx.rated.has(b.id),
  });
  const l = ctx.listing.get(b.listingId);
  return {
    id: b.id,
    state: b.state,
    listing: l ? { id: l.id, title: l.title, kind: l.kind, category: l.category } : { id: b.listingId, title: "", kind: "item", category: "" },
    lender: party(ctx, b.societyId, b.lenderId),
    borrower: party(ctx, b.societyId, b.borrowerId),
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    pricing: b.pricing,
    feePaise: b.feePaise,
    depositPaise: b.depositPaise,
    replacementValuePaise: b.replacementValuePaise,
    platformFeePaise: b.platformFeePaise,
    myRole: role,
    nextAction,
    deadlineAt: iso(deadlineAt),
  };
}

export async function bookingSummaries(rows: Booking[], callerId: string) {
  const ctx = await loadContext(rows, callerId);
  return rows.map((b) => summarize(b, ctx, callerId));
}

export function paymentView(b: Booking, p: Payment, lender: UserRow, borrower: UserRow) {
  const provider = depositProvider(p.depositMode);
  const ref = (u: UserRow) => ({ id: u.id, displayName: u.displayName, upiVpa: u.upiVpa });
  const intents = provider.paymentIntents({ bookingId: b.id, lender: ref(lender), feePaise: p.feePaise, depositPaise: p.depositPaise });
  // Any refund still owed: the p2p deposit after COMPLETED, or fee (+ p2p deposit) after a paid CANCELLED.
  const refundOpen = p.refundDuePaise > 0 && !p.refundConfirmedAt;
  const refundPurpose = p.depositMode === "p2p" && p.refundDuePaise <= p.depositPaise && b.state !== "CANCELLED" ? "deposit refund" : "refund";
  const payee = p.awardPayeeId === lender.id ? lender : p.awardPayeeId === borrower.id ? borrower : null;
  const awardOpen = p.awardStatus === "debt_recorded" || p.awardStatus === "paid_claimed";
  return {
    depositMode: p.depositMode,
    feePaise: p.feePaise,
    depositPaise: p.depositPaise,
    feeUpiIntent: intents.feeUpiIntent ?? "",
    depositUpiIntent: intents.depositUpiIntent,
    refundUpiIntent: refundOpen ? refundIntent(b.id, ref(borrower), p.refundDuePaise, refundPurpose) : null,
    // Only the part not already kept out of a p2p deposit is paid over UPI.
    awardUpiIntent: awardOpen && payee ? awardIntent(b.id, ref(payee), p.awardPaise - p.awardFromDepositPaise) : null,
    claimedAt: iso(p.claimedAt),
    confirmedAt: iso(p.confirmedAt),
    utr: p.utr,
    depositStatus: p.depositStatus,
    refundDuePaise: p.refundDuePaise,
    refundClaimedAt: iso(p.refundClaimedAt),
    refundConfirmedAt: iso(p.refundConfirmedAt),
    awardPaise: p.awardPaise,
    awardFromDepositPaise: p.awardFromDepositPaise,
    awardStatus: p.awardStatus,
    awardPayerId: p.awardPayerId,
    awardPayeeId: p.awardPayeeId,
  };
}

export async function mediaView(m: typeof inspectionMedia.$inferSelect) {
  return {
    id: m.id,
    slot: m.slot,
    // Only the immutable evidence-final/ copy is ever served (never the upload staging key).
    url: m.finalKey ? await presignDownload(m.finalKey) : null,
    mime: m.mime,
    receivedAt: iso(m.receivedAt),
    withinGeofence: m.withinGeofence ?? false,
    noLocation: m.lat == null,
    clockSkewFlag: m.clockSkewFlag,
  };
}

export function disputeView(d: Dispute) {
  return {
    id: d.id,
    raisedBy: d.raisedBySystem ? "system" : d.raisedBy,
    raisedBySystem: d.raisedBySystem,
    category: d.category,
    description: d.description,
    claimedPaise: d.claimedPaise,
    responseText: d.responseText,
    offerPaise: d.responseOfferPaise,
    status: d.status,
    awardPaise: d.awardPaise,
    rulingNote: d.rulingNote,
    resolvedAt: iso(d.resolvedAt),
    createdAt: d.createdAt.toISOString(),
    escalatedAt: iso(d.escalatedAt),
    deadlineAt: iso(disputeDeadline(d)),
  };
}

export async function bookingDetail(b: Booking, callerId: string) {
  const ctx = await loadContext([b], callerId);
  const summary = summarize(b, ctx, callerId);
  const p = ctx.payment.get(b.id) ?? null;
  const d = ctx.dispute.get(b.id) ?? null;
  const lender = ctx.user.get(b.lenderId)!;
  const borrower = ctx.user.get(b.borrowerId)!;

  const [media, events, [soc]] = await Promise.all([
    db.select().from(inspectionMedia).where(and(eq(inspectionMedia.bookingId, b.id), eq(inspectionMedia.status, "verified"))),
    db
      .select({ fromState: bookingEvents.fromState, toState: bookingEvents.toState, reason: bookingEvents.reason, at: bookingEvents.at })
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingId, b.id))
      .orderBy(asc(bookingEvents.id)),
    db
      .select({ id: societies.id, name: societies.name, centerLat: societies.centerLat, centerLng: societies.centerLng, radiusM: societies.radiusM })
      .from(societies)
      .where(eq(societies.id, b.societyId)),
  ]);

  const inspectionViews = await Promise.all(
    ctx.inspections.map(async (x) => ({
      id: x.id,
      phase: x.phase,
      party: x.party,
      checklistAnswers: x.checklistAnswers,
      withinGeofence: x.withinGeofence,
      noLocation: x.lat == null,
      submittedAt: x.submittedAt.toISOString(),
      media: await Promise.all(media.filter((m) => m.inspectionId === x.id).map(mediaView)),
      ack: x.ackAt
        ? {
            result: x.ackResult,
            note: x.ackNote,
            at: x.ackAt.toISOString(),
            media: await Promise.all(media.filter((m) => m.ackInspectionId === x.id).map(mediaView)),
          }
        : null,
    })),
  );

  return {
    ...summary,
    society: soc ?? null,
    checklistSnapshot: b.checklistSnapshot,
    photoSlotsSnapshot: b.photoSlotsSnapshot,
    payment: p ? paymentView(b, p, lender, borrower) : null,
    inspections: inspectionViews,
    dispute: d
      ? { ...disputeView(d), media: await Promise.all(media.filter((m) => m.disputeId === d.id).map(mediaView)) }
      : null,
    events: events.map((e) => ({ fromState: e.fromState, toState: e.toState, reason: e.reason, at: e.at.toISOString() })),
  };
}
