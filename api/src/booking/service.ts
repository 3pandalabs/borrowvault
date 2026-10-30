import { and, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, type Tx } from "../db/index.js";
import {
  bookingEvents,
  bookingPayments,
  bookings,
  disputeMessages,
  disputes,
  inspectionMedia,
  inspections,
  listings,
  ratings,
  societies,
  users,
  type ChecklistAnswer,
} from "../db/schema.js";
import { approvedMembership, assertArbiter, requireApprovedMember } from "../lib/authz.js";
import { alreadySubmitted, conflict, DomainError, forbidden, invalid, notFound } from "../lib/errors.js";
import { withinGeofence } from "../lib/geo.js";
import { notifyUsers, notifyPlatformAdmins, notifySocietyAdmins } from "../lib/notify.js";
import { depositProvider, netRefundDue, refundDueOnCancel, type DepositMode, type ResolutionOutcome } from "../payments/provider.js";
import { priceFor, type Pricing } from "./pricing.js";
import {
  CANCELLABLE_STATES,
  DISPUTABLE_STATES,
  OCCUPYING_STATES,
  overdueCountsAgainstTrust,
  type BookingState,
} from "./states.js";
import { transition, TransitionConflict } from "./transition.js";
import { BORROWING_PAUSED_BELOW, computeTrustScore } from "./trust.js";

// All booking business logic. Routes call the non-state-changing parts inline;
// Temporal activities (temporal/activities/booking.ts) wrap the state-changing
// parts so the booking workflow owns time and retries. Every function here is
// idempotent or guarded by transition()'s conditional update, so an activity
// retry can never apply an effect twice.

export type Booking = typeof bookings.$inferSelect;
export type PartyRole = "lender" | "borrower";
export type Geo = { lat: number; lng: number; accuracyM: number; capturedAt: string };

const link = (bookingId: string) => `/bookings/${bookingId}`;

export async function loadBooking(bookingId: string, q: Pick<Tx, "select"> = db): Promise<Booking> {
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) throw notFound();
  const [b] = await q.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!b) throw notFound();
  return b;
}

export function partyOf(b: Booking, userId: string): PartyRole {
  if (b.lenderId === userId) return "lender";
  if (b.borrowerId === userId) return "borrower";
  throw forbidden("not a party to this booking");
}

const otherParty = (b: Booking, role: PartyRole) => (role === "lender" ? b.borrowerId : b.lenderId);

function isPgCode(err: unknown, code: string): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur; i++) {
    if ((cur as { code?: string }).code === code) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
const isExclusionViolation = (err: unknown) => isPgCode(err, "23P01");

async function societyDepositMode(societyId: string, q: Pick<Tx, "select"> = db): Promise<DepositMode> {
  const [s] = await q.select({ settings: societies.settings }).from(societies).where(eq(societies.id, societyId));
  return s?.settings?.depositMode === "p2p" ? "p2p" : "declared";
}

async function loadPayment(bookingId: string, q: Pick<Tx, "select"> = db) {
  const [p] = await q.select().from(bookingPayments).where(eq(bookingPayments.bookingId, bookingId)).limit(1);
  return p ?? null;
}

export async function currentState(bookingId: string): Promise<BookingState> {
  return (await loadBooking(bookingId)).state;
}

/**
 * New actions (create booking, accept, payment claim/confirm, listing writes)
 * need an APPROVED membership in the booking's society. In-flight obligations
 * (return, ack, dispute, refund, award, rating) stay open to a revoked party.
 */
async function requireApprovedParty(userId: string, societyId: string): Promise<void> {
  if (!(await approvedMembership(userId, societyId))) {
    throw forbidden("your membership in this society is not approved");
  }
}

/** Accept / payment-confirm are pointless once the rental window has ended. */
function assertWindowOpen(b: Booking): void {
  if (Date.now() >= b.endsAt.getTime()) {
    throw new DomainError("WINDOW_PASSED", "the booking window has already ended");
  }
}

// ---------------------------------------------------------------------------
// Create (inline in POST /bookings, then the route starts bookingWorkflow)
// ---------------------------------------------------------------------------

export async function hasOutstandingDebt(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: bookingPayments.bookingId })
    .from(bookingPayments)
    .where(
      and(eq(bookingPayments.awardPayerId, userId), inArray(bookingPayments.awardStatus, ["debt_recorded", "paid_claimed"])),
    )
    .limit(1);
  return rows.length > 0;
}

export async function createBooking(i: {
  borrowerId: string;
  listingId: string;
  startsAt: string;
  endsAt: string;
  pricing: Pricing;
}): Promise<Booking> {
  if (!/^[0-9a-f-]{36}$/i.test(i.listingId)) throw notFound();
  const [l] = await db.select().from(listings).where(eq(listings.id, i.listingId)).limit(1);
  if (!l) throw notFound();
  await requireApprovedMember(i.borrowerId, l.societyId); // 404 outside your society
  if (l.status !== "active") throw invalid("this listing is not available");
  if (l.ownerId === i.borrowerId) throw invalid("you cannot borrow your own listing");
  if (!(await approvedMembership(l.ownerId, l.societyId))) throw invalid("this listing is not available");

  const [borrower] = await db.select().from(users).where(eq(users.id, i.borrowerId));
  if (borrower.trustScore < BORROWING_PAUSED_BELOW) {
    throw forbidden("borrowing is paused pending a society admin review");
  }
  if (await hasOutstandingDebt(i.borrowerId)) {
    throw forbidden("settle your outstanding dispute award before borrowing");
  }

  const start = new Date(i.startsAt);
  const end = new Date(i.endsAt);
  if (start.getTime() < Date.now() - 5 * 60_000) throw invalid("startsAt is in the past");
  let fee: number;
  try {
    fee = priceFor(l, i.pricing, start, end);
  } catch (e) {
    throw invalid((e as Error).message);
  }

  const busy = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.listingId, l.id),
        inArray(bookings.state, [...OCCUPYING_STATES]),
        sql`tstzrange(${bookings.startsAt}, ${bookings.endsAt}) && tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz)`,
      ),
    )
    .limit(1);
  if (busy.length) throw new DomainError("OVERLAP", "the item is already booked for that time");

  const isSkill = l.kind === "skill";
  return db.transaction(async (tx) => {
    const [b] = await tx
      .insert(bookings)
      .values({
        societyId: l.societyId,
        listingId: l.id,
        lenderId: l.ownerId,
        borrowerId: i.borrowerId,
        pricing: i.pricing,
        startsAt: start,
        endsAt: end,
        feePaise: fee,
        depositPaise: isSkill ? 0 : l.depositPaise,
        replacementValuePaise: isSkill ? null : l.replacementValuePaise,
        platformFeePaise: 0, // Phase 1: no platform fee (no gateway to collect it)
        checklistSnapshot: isSkill ? [] : l.checklistTemplate,
        photoSlotsSnapshot: isSkill ? [] : l.requiredPhotoSlots,
      })
      .returning();
    // Creation is an insert, not a state change; the event row keeps the audit log complete.
    await tx.insert(bookingEvents).values({
      bookingId: b.id,
      fromState: null,
      toState: "REQUESTED",
      actorId: i.borrowerId,
      reason: "requested",
    });
    return b;
  });
}

/** Used when the workflow can't be started: don't leave a REQUESTED booking with no timers. */
export async function abandonBooking(bookingId: string): Promise<void> {
  await db
    .transaction((tx) =>
      transition(tx, { bookingId, from: "REQUESTED", to: "CANCELLED", actorId: null, reason: "workflow_unavailable" }),
    )
    .catch(() => undefined);
}

export async function notifyRequested(bookingId: string): Promise<void> {
  const b = await loadBooking(bookingId);
  await notifyUsers([b.lenderId], "New BorrowVault booking request", "A neighbour wants to borrow your listing. Accept or decline within 12 hours.", link(b.id));
}

// ---------------------------------------------------------------------------
// Lender decisions
// ---------------------------------------------------------------------------

export async function accept(i: { bookingId: string; actorId: string }): Promise<BookingState> {
  const b = await loadBooking(i.bookingId);
  if (partyOf(b, i.actorId) !== "lender") throw forbidden("only the lender can accept");
  await requireApprovedParty(i.actorId, b.societyId);
  assertWindowOpen(b);
  const [l] = await db.select({ status: listings.status }).from(listings).where(eq(listings.id, b.listingId));
  if (l?.status !== "active") throw new DomainError("CONFLICT", "this listing is no longer active");
  const [lender] = await db.select().from(users).where(eq(users.id, b.lenderId));
  if (!lender.upiVpa) throw invalid("add your UPI ID to your profile before accepting");
  const mode = await societyDepositMode(b.societyId);
  try {
    const state = await db.transaction(async (tx) => {
      const s = await transition(tx, {
        bookingId: b.id,
        from: "REQUESTED",
        to: "ACCEPTED",
        actorId: i.actorId,
        reason: "lender_accepted",
        data: { depositMode: mode },
      });
      await tx
        .insert(bookingPayments)
        .values({
          bookingId: b.id,
          depositMode: mode,
          feePaise: b.feePaise,
          depositPaise: b.depositPaise,
          depositStatus: "pending",
        })
        .onConflictDoNothing();
      return s;
    });
    await notifyUsers([b.borrowerId], "Your BorrowVault request was accepted", "Pay the rental fee via UPI within 2 hours to confirm.", link(b.id));
    return state;
  } catch (err) {
    if (isExclusionViolation(err)) throw new DomainError("OVERLAP", "the item is already booked for that time");
    throw err;
  }
}

export async function decline(i: { bookingId: string; actorId: string }): Promise<BookingState> {
  const b = await loadBooking(i.bookingId);
  if (partyOf(b, i.actorId) !== "lender") throw forbidden("only the lender can decline");
  const s = await db.transaction((tx) =>
    transition(tx, { bookingId: b.id, from: "REQUESTED", to: "DECLINED", actorId: i.actorId, reason: "lender_declined" }),
  );
  await notifyUsers([b.borrowerId], "Your BorrowVault request was declined", "The lender declined your booking request.", link(b.id));
  return s;
}

export async function cancel(i: { bookingId: string; actorId: string }): Promise<BookingState> {
  const b = await loadBooking(i.bookingId);
  const role = partyOf(b, i.actorId);
  if (!CANCELLABLE_STATES.includes(b.state)) throw conflict(`cannot cancel a booking that is ${b.state}`);
  const { state: s, refundDuePaise } = await cancelWithRefund(b, CANCELLABLE_STATES, i.actorId, `${role}_cancelled`);
  await notifyUsers(
    [otherParty(b, role)],
    "A BorrowVault booking was cancelled",
    refundDuePaise > 0
      ? `The ${role} cancelled the booking. The lender must refund Rs ${(refundDuePaise / 100).toFixed(2)} via UPI within 24 hours.`
      : `The ${role} cancelled the booking.`,
    link(b.id),
  );
  return s;
}

/**
 * CANCELLED + refund bookkeeping in one transaction. If the lender had already
 * confirmed payment, the borrower is owed the fee (+ the p2p deposit); the
 * workflow then runs the same 24 h refund timer as after COMPLETED.
 */
async function cancelWithRefund(
  b: Booking,
  from: readonly BookingState[],
  actorId: string | null,
  reason: string,
): Promise<{ state: BookingState; refundDuePaise: number }> {
  const p = await loadPayment(b.id);
  const r = p
    ? refundDueOnCancel({
        depositMode: p.depositMode,
        feePaise: p.feePaise,
        depositPaise: p.depositPaise,
        paymentConfirmed: Boolean(p.confirmedAt),
      })
    : { refundDuePaise: 0, depositStatus: "none" as const };
  const state = await db.transaction(async (tx) => {
    const st = await transition(tx, { bookingId: b.id, from, to: "CANCELLED", actorId, reason, data: { refundDuePaise: r.refundDuePaise } });
    if (p) {
      await tx
        .update(bookingPayments)
        .set({ refundDuePaise: r.refundDuePaise, depositStatus: r.depositStatus, updatedAt: new Date() })
        .where(eq(bookingPayments.bookingId, b.id));
    }
    return st;
  });
  return { state, refundDuePaise: r.refundDuePaise };
}

// ---------------------------------------------------------------------------
// Payment (UPI intent, claim -> confirm)
// ---------------------------------------------------------------------------

/** Inline: borrower says "I've paid via UPI". No state change. */
export async function claimPayment(i: { bookingId: string; actorId: string; utr?: string }) {
  const b = await loadBooking(i.bookingId);
  if (partyOf(b, i.actorId) !== "borrower") throw forbidden("only the borrower can claim payment");
  await requireApprovedParty(i.actorId, b.societyId);
  if (b.state !== "ACCEPTED") throw conflict(`no payment is due while ${b.state}`);
  await db
    .update(bookingPayments)
    .set({ claimedAt: new Date(), utr: i.utr ?? null, updatedAt: new Date() })
    .where(and(eq(bookingPayments.bookingId, b.id), isNull(bookingPayments.confirmedAt)));
  await notifyUsers([b.lenderId], "Borrower says they've paid", "Check your UPI app and confirm receipt on BorrowVault.", link(b.id));
}

/** Activity: lender says "Received" -> DEPOSIT_HELD. */
export async function confirmPayment(i: { bookingId: string; actorId: string }): Promise<BookingState> {
  const b = await loadBooking(i.bookingId);
  if (partyOf(b, i.actorId) !== "lender") throw forbidden("only the lender can confirm payment");
  await requireApprovedParty(i.actorId, b.societyId);
  assertWindowOpen(b);
  const p = await loadPayment(b.id);
  if (!p) throw conflict("no payment is due");
  const provider = depositProvider(p.depositMode);
  const s = await db.transaction(async (tx) => {
    const s = await transition(tx, {
      bookingId: b.id,
      from: "ACCEPTED",
      to: "DEPOSIT_HELD",
      actorId: i.actorId,
      reason: "lender_confirmed_payment",
      data: { depositMode: p.depositMode, utr: p.utr },
    });
    await tx
      .update(bookingPayments)
      .set({ confirmedAt: new Date(), depositStatus: provider.onPaymentConfirmed(p.depositPaise), updatedAt: new Date() })
      .where(eq(bookingPayments.bookingId, b.id));
    return s;
  });
  await notifyUsers([b.borrowerId], "Payment confirmed", "The lender confirmed your payment. Meet for the handover at the start time.", link(b.id));
  return s;
}

// ---------------------------------------------------------------------------
// Timers (activities)
// ---------------------------------------------------------------------------

/**
 * A timer firing. If someone else moved the booking first, that's not an
 * error: return whatever state it's in now. Idempotent under retries.
 */
export async function timerTransition(i: {
  bookingId: string;
  from: BookingState | BookingState[];
  to: BookingState;
  reason: string;
}): Promise<BookingState> {
  try {
    return await db.transaction((tx) =>
      transition(tx, { bookingId: i.bookingId, from: i.from, to: i.to, actorId: null, reason: i.reason }),
    );
  } catch (err) {
    if (err instanceof TransitionConflict) return currentState(i.bookingId);
    throw err;
  }
}

export async function expire(i: { bookingId: string; from: "REQUESTED" | "ACCEPTED" }): Promise<BookingState> {
  const s = await timerTransition({
    bookingId: i.bookingId,
    from: i.from,
    to: "EXPIRED",
    reason: i.from === "REQUESTED" ? "lender_no_response_12h" : "payment_not_confirmed_2h",
  });
  if (s === "EXPIRED") {
    const b = await loadBooking(i.bookingId);
    await notifyUsers([b.lenderId, b.borrowerId], "A BorrowVault booking expired", "The booking expired because nobody acted in time.", link(b.id));
  }
  return s;
}

/** startsAt - 1 h: open the handover. Skill gigs have no handover inspection and go straight to ACTIVE. */
export async function openHandover(i: { bookingId: string }): Promise<BookingState> {
  let s = await timerTransition({ bookingId: i.bookingId, from: "DEPOSIT_HELD", to: "HANDOVER_PENDING", reason: "handover_window_open" });
  const b = await loadBooking(i.bookingId);
  const [l] = await db.select({ kind: listings.kind }).from(listings).where(eq(listings.id, b.listingId));
  if (s === "HANDOVER_PENDING" && l?.kind === "skill") {
    s = await timerTransition({ bookingId: b.id, from: "HANDOVER_PENDING", to: "ACTIVE", reason: "skill_no_handover" });
  }
  if (s === "HANDOVER_PENDING") {
    await notifyUsers([b.lenderId, b.borrowerId], "Time to meet for the handover", "Both of you photograph the item in the app; the borrower then confirms the lender's photos.", link(b.id));
  }
  return s;
}

/** Event reason that counts as a lender no-show strike in the trust score. */
export const LENDER_NO_SHOW_REASON = "lender_no_show_handover_24h";

export async function handoverTimeout(i: { bookingId: string }): Promise<BookingState> {
  const b = await loadBooking(i.bookingId);
  let r: { state: BookingState; refundDuePaise: number };
  try {
    r = await cancelWithRefund(b, ["HANDOVER_PENDING"], null, LENDER_NO_SHOW_REASON);
  } catch (err) {
    if (err instanceof TransitionConflict) return currentState(b.id);
    throw err;
  }
  await recomputeTrust(b.lenderId); // records the no-show strike
  await notifyUsers(
    [b.lenderId, b.borrowerId],
    "A BorrowVault booking was cancelled",
    r.refundDuePaise > 0
      ? `The handover wasn't completed within 24 hours of the start time. The lender must refund Rs ${(r.refundDuePaise / 100).toFixed(2)} via UPI within 24 hours.`
      : "The handover wasn't completed within 24 hours of the start time.",
    link(b.id),
  );
  return r.state;
}

export async function markOverdue(i: { bookingId: string }): Promise<BookingState> {
  const s = await timerTransition({ bookingId: i.bookingId, from: "ACTIVE", to: "OVERDUE", reason: "return_time_passed" });
  if (s === "OVERDUE") {
    const b = await loadBooking(i.bookingId);
    await notifyUsers([b.borrowerId], "Your BorrowVault rental is due", "The return time has passed. Return the item and photograph it in the app.", link(b.id));
  }
  return s;
}

export async function nudgeOverdue(i: { bookingId: string; hoursLate: number; alertAdmins: boolean }): Promise<void> {
  const b = await loadBooking(i.bookingId);
  if (b.state !== "OVERDUE") return;
  await notifyUsers([b.borrowerId], `Your BorrowVault rental is ${i.hoursLate} h overdue`, "Please return the item and photograph it in the app.", link(b.id));
  if (i.alertAdmins) {
    await notifySocietyAdmins(b.societyId, "Overdue rental needs attention", `A booking is ${i.hoursLate} hours overdue.`, link(b.id));
  }
}

export async function autoComplete(i: { bookingId: string }): Promise<BookingState> {
  const b = await loadBooking(i.bookingId);
  try {
    return await completeBooking(b, null, "lender_silent_24h");
  } catch (err) {
    if (err instanceof TransitionConflict) return currentState(b.id);
    throw err;
  }
}

async function completeBooking(b: Booking, actorId: string | null, reason: string): Promise<BookingState> {
  const p = await loadPayment(b.id);
  const s = await db.transaction(async (tx) => {
    const s = await transition(tx, { bookingId: b.id, from: "RETURN_PENDING", to: "COMPLETED", actorId, reason });
    if (p) {
      const out = depositProvider(p.depositMode).onCompleted(p.depositPaise);
      await tx
        .update(bookingPayments)
        .set({ depositStatus: out.depositStatus, refundDuePaise: out.refundDuePaise, updatedAt: new Date() })
        .where(eq(bookingPayments.bookingId, b.id));
    }
    return s;
  });
  const refund = p?.depositMode === "p2p" && p.depositPaise > 0;
  await notifyUsers(
    [b.lenderId, b.borrowerId],
    "BorrowVault rental completed",
    refund ? "The rental is complete. The lender must refund the deposit via UPI within 24 hours." : "The rental is complete. Rate each other in the app.",
    link(b.id),
  );
  return s;
}

/** After COMPLETED in p2p mode: is a deposit refund still unconfirmed? */
/** After COMPLETED (p2p deposit) or CANCELLED (after payment): is a refund still unconfirmed? */
export async function refundOutstanding(i: { bookingId: string }): Promise<boolean> {
  const p = await loadPayment(i.bookingId);
  return Boolean(p && p.refundDuePaise > 0 && !p.refundConfirmedAt);
}

/**
 * 24 h after COMPLETED/CANCELLED with a refund still unconfirmed: the system
 * raises a "late" dispute on the borrower's behalf (system-only transition).
 */
export async function autoDisputeIfUnrefunded(i: { bookingId: string }): Promise<BookingState> {
  const b = await loadBooking(i.bookingId);
  if ((b.state !== "COMPLETED" && b.state !== "CANCELLED") || !(await refundOutstanding(i))) return b.state;
  const from: BookingState = b.state;
  const p = (await loadPayment(b.id))!;
  try {
    const s = await db.transaction(async (tx) => {
      const [d] = await tx
        .insert(disputes)
        .values({
          bookingId: b.id,
          raisedBy: b.borrowerId,
          raisedBySystem: true,
          category: "late",
          description:
            from === "CANCELLED"
              ? "Refund after cancellation not confirmed within 24 hours (raised automatically on the borrower's behalf)."
              : "Deposit refund not confirmed within 24 hours of completion (raised automatically on the borrower's behalf).",
          claimedPaise: p.refundDuePaise,
        })
        .onConflictDoNothing()
        .returning({ id: disputes.id });
      if (!d) throw conflict("dispute already exists");
      await tx.insert(disputeMessages).values({ disputeId: d.id, authorId: null, body: "Raised automatically: refund overdue." });
      return transition(tx, {
        bookingId: b.id,
        from,
        to: "DISPUTED",
        actorId: null,
        reason: "refund_overdue",
        data: { disputeId: d.id },
      });
    });
    await notifyUsers([b.lenderId, b.borrowerId], "Refund overdue", "The refund wasn't confirmed in 24 hours, so a dispute was opened.", link(b.id));
    await notifySocietyAdmins(b.societyId, "Refund overdue", "A refund is overdue; a dispute was opened automatically.", link(b.id));
    return s;
  } catch (err) {
    if (err instanceof DomainError) return currentState(b.id);
    throw err;
  }
}

export async function escalateDispute(i: { bookingId: string }): Promise<void> {
  const updated = await db
    .update(disputes)
    .set({ status: "escalated", escalatedAt: new Date() })
    .where(and(eq(disputes.bookingId, i.bookingId), inArray(disputes.status, ["open", "awaiting_response", "under_review"])))
    .returning({ id: disputes.id });
  if (updated.length) {
    await notifyPlatformAdmins("Dispute escalated to 3PandaLabs", "A dispute has had no ruling for 72 hours.", link(i.bookingId));
  }
}

// ---------------------------------------------------------------------------
// Inspections (activities: they can change state)
// ---------------------------------------------------------------------------

export type InspectionInput = {
  bookingId: string;
  actorId: string;
  phase: "handover" | "return";
  mediaIds: string[];
  checklistAnswers: Record<string, ChecklistAnswer>;
  /** null = the device could not get a fix: stored as "no location", withinGeofence = false. Never rejected. */
  geo: Geo | null;
};

export async function submitInspection(i: InspectionInput): Promise<BookingState> {
  const b = await loadBooking(i.bookingId);
  const role = partyOf(b, i.actorId);

  if (i.phase === "handover" && b.state !== "HANDOVER_PENDING") throw conflict(`no handover inspection while ${b.state}`);
  if (i.phase === "return") {
    if (role === "borrower" && b.state !== "ACTIVE" && b.state !== "OVERDUE") {
      throw conflict(`no return inspection while ${b.state}`);
    }
    // Return flow (contract decision): the lender does NOT submit a return
    // inspection. They ack the borrower's: agreed -> COMPLETED; objected -> must
    // raise a dispute inside the same 24 h window, else it auto-completes.
    if (role === "lender") throw forbidden("the lender reviews the borrower's return inspection via /inspections/ack");
  }

  const [existing] = await db
    .select({ id: inspections.id })
    .from(inspections)
    .where(and(eq(inspections.bookingId, b.id), eq(inspections.phase, i.phase), eq(inspections.party, role)));
  if (existing) throw alreadySubmitted("inspection already submitted");

  const media = i.mediaIds.length
    ? await db.select().from(inspectionMedia).where(inArray(inspectionMedia.id, i.mediaIds))
    : [];
  if (media.length !== new Set(i.mediaIds).size) throw invalid("unknown media id");
  // One party can never submit the other's evidence: uploader must be the actor.
  if (media.some((m) => m.bookingId !== b.id || m.uploaderId !== i.actorId || m.phase !== i.phase)) {
    throw forbidden("media does not belong to this inspection");
  }
  if (media.some((m) => m.status !== "verified")) throw invalid("some photos are not finalized");
  if (media.some((m) => m.inspectionId || m.ackInspectionId || m.disputeId)) throw invalid("media already used elsewhere");

  const missing = b.photoSlotsSnapshot.filter((s) => !media.some((m) => m.slot === s));
  if (missing.length) throw invalid(`missing photos: ${missing.join(", ")}`);
  const unanswered = b.checklistSnapshot.filter((it) => !(it.id in i.checklistAnswers));
  if (unanswered.length) throw invalid(`checklist incomplete: ${unanswered.map((u) => u.id).join(", ")}`);

  const [soc] = await db.select().from(societies).where(eq(societies.id, b.societyId));
  const within = i.geo ? withinGeofence(i.geo, soc) : false;

  const state = await db.transaction(async (tx) => {
    const [ins] = await tx
      .insert(inspections)
      .values({
        bookingId: b.id,
        phase: i.phase,
        party: role,
        submittedBy: i.actorId,
        checklistAnswers: i.checklistAnswers,
        lat: i.geo?.lat ?? null,
        lng: i.geo?.lng ?? null,
        accuracyM: i.geo?.accuracyM ?? null,
        withinGeofence: within,
        clientCapturedAt: i.geo ? new Date(i.geo.capturedAt) : new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: inspections.id });
    if (!ins) throw alreadySubmitted("inspection already submitted");
    if (i.mediaIds.length) {
      await tx.update(inspectionMedia).set({ inspectionId: ins.id }).where(inArray(inspectionMedia.id, i.mediaIds));
    }

    if (i.phase === "return" && role === "borrower") {
      return transition(tx, {
        bookingId: b.id,
        from: ["ACTIVE", "OVERDUE"],
        to: "RETURN_PENDING",
        actorId: i.actorId,
        reason: "borrower_returned",
        data: { inspectionId: ins.id, withinGeofence: within },
      });
    }
    if (i.phase === "handover") return maybeActivate(tx, b.id, i.actorId);
    return b.state;
  });

  if (state === "RETURN_PENDING") {
    await notifyUsers([b.lenderId], "Item returned", "Review the return photos within 24 hours, or the rental completes automatically.", link(b.id));
  } else if (state === "HANDOVER_PENDING") {
    await notifyUsers([otherParty(b, role)], "Handover photos submitted", `The ${role} submitted handover photos.`, link(b.id));
  }
  return state;
}

/** ACTIVE once both handover inspections exist AND the borrower agreed to the lender's. */
async function maybeActivate(tx: Tx, bookingId: string, actorId: string): Promise<BookingState> {
  const rows = await tx
    .select({ party: inspections.party, ackResult: inspections.ackResult })
    .from(inspections)
    .where(and(eq(inspections.bookingId, bookingId), eq(inspections.phase, "handover")));
  const lender = rows.find((r) => r.party === "lender");
  const borrower = rows.find((r) => r.party === "borrower");
  if (lender && borrower && lender.ackResult === "agreed") {
    return transition(tx, { bookingId, from: "HANDOVER_PENDING", to: "ACTIVE", actorId, reason: "handover_complete" });
  }
  const [b] = await tx.select({ state: bookings.state }).from(bookings).where(eq(bookings.id, bookingId));
  return b.state;
}

export type AckInput = {
  bookingId: string;
  actorId: string;
  phase: "handover" | "return";
  result: "agreed" | "objected";
  note?: string;
  /** Objection photos: the acker's own verified uploads for this phase, slot "objection", max 5. */
  mediaIds?: string[];
};

export async function ackInspection(i: AckInput): Promise<BookingState> {
  const b = await loadBooking(i.bookingId);
  const role = partyOf(b, i.actorId);
  if (i.phase === "handover" && b.state !== "HANDOVER_PENDING") throw conflict(`cannot acknowledge handover while ${b.state}`);
  if (i.phase === "return" && b.state !== "RETURN_PENDING") throw conflict(`cannot acknowledge return while ${b.state}`);

  const counter: PartyRole = role === "lender" ? "borrower" : "lender";
  const [target] = await db
    .select()
    .from(inspections)
    .where(and(eq(inspections.bookingId, b.id), eq(inspections.phase, i.phase), eq(inspections.party, counter)));
  if (!target) throw conflict(`the ${counter} hasn't submitted a ${i.phase} inspection yet`);
  const completesReturn = i.phase === "return" && role === "lender";
  if (target.ackAt) {
    // Activity retry after the ack committed but before completion did: finish the job.
    if (completesReturn && target.ackBy === i.actorId && target.ackResult === "agreed") {
      return completeBooking(b, i.actorId, "lender_agreed");
    }
    throw alreadySubmitted("already acknowledged");
  }

  const mediaIds = i.mediaIds ?? [];
  if (mediaIds.length > 5) throw invalid("at most 5 objection photos");
  if (mediaIds.length) {
    const media = await db.select().from(inspectionMedia).where(inArray(inspectionMedia.id, mediaIds));
    if (media.length !== new Set(mediaIds).size) throw invalid("unknown media id");
    if (media.some((m) => m.bookingId !== b.id || m.uploaderId !== i.actorId || m.phase !== i.phase || m.slot !== "objection")) {
      throw forbidden("objection media must be your own uploads for this phase with slot objection");
    }
    if (media.some((m) => m.status !== "verified")) throw invalid("some photos are not finalized");
    if (media.some((m) => m.inspectionId || m.ackInspectionId || m.disputeId)) throw invalid("media already used elsewhere");
  }

  const state = await db.transaction(async (tx) => {
    const done = await tx
      .update(inspections)
      .set({ ackBy: i.actorId, ackResult: i.result, ackNote: i.note ?? null, ackAt: new Date() })
      .where(and(eq(inspections.id, target.id), isNull(inspections.ackAt)))
      .returning({ id: inspections.id });
    if (!done.length) throw alreadySubmitted("already acknowledged");
    if (mediaIds.length) {
      await tx.update(inspectionMedia).set({ ackInspectionId: target.id }).where(inArray(inspectionMedia.id, mediaIds));
    }
    if (i.phase === "handover" && role === "borrower" && i.result === "agreed") return maybeActivate(tx, b.id, i.actorId);
    return b.state;
  });

  if (completesReturn && i.result === "agreed") {
    return completeBooking(b, i.actorId, "lender_agreed");
  }
  if (i.result === "objected") {
    await notifyUsers([otherParty(b, role)], "Inspection objected", `The ${role} objected to your ${i.phase} photos.${i.note ? ` Note: ${i.note}` : ""}`, link(b.id));
  }
  return state;
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

export type DisputeInput = {
  bookingId: string;
  actorId: string;
  category: "damage" | "missing_part" | "not_returned" | "not_as_described" | "late";
  description: string;
  claimedPaise: number;
  mediaIds: string[];
};

export async function raiseDispute(i: DisputeInput): Promise<{ state: BookingState; disputeId: string }> {
  const b = await loadBooking(i.bookingId);
  const role = partyOf(b, i.actorId);
  if (!DISPUTABLE_STATES.includes(b.state)) throw conflict(`cannot raise a dispute while ${b.state}`);

  const p = await loadPayment(b.id);
  // Snapshot taken at booking creation: editing the listing can't move the cap.
  const cap = depositProvider(p?.depositMode ?? "declared").claimCap({
    raiser: role,
    feePaise: b.feePaise,
    depositPaise: b.depositPaise,
    replacementValuePaise: b.replacementValuePaise,
  });
  if (i.claimedPaise > cap) throw invalid(`claim cannot exceed ${cap} paise`);

  const media = i.mediaIds.length ? await db.select().from(inspectionMedia).where(inArray(inspectionMedia.id, i.mediaIds)) : [];
  if (media.length !== new Set(i.mediaIds).size) throw invalid("unknown media id");
  if (media.some((m) => m.bookingId !== b.id || m.uploaderId !== i.actorId || m.phase !== "dispute")) {
    throw forbidden("media does not belong to this dispute");
  }
  if (media.some((m) => m.status !== "verified")) throw invalid("some photos are not finalized");
  if (media.some((m) => m.disputeId || m.ackInspectionId || m.inspectionId)) throw invalid("media already used elsewhere");

  const out = await db.transaction(async (tx) => {
    const [d] = await tx
      .insert(disputes)
      .values({
        bookingId: b.id,
        raisedBy: i.actorId,
        category: i.category,
        description: i.description,
        claimedPaise: i.claimedPaise,
      })
      .onConflictDoNothing()
      .returning({ id: disputes.id });
    if (!d) throw alreadySubmitted("a dispute already exists for this booking");
    if (i.mediaIds.length) {
      await tx.update(inspectionMedia).set({ disputeId: d.id }).where(inArray(inspectionMedia.id, i.mediaIds));
    }
    await tx.insert(disputeMessages).values({ disputeId: d.id, authorId: i.actorId, body: i.description });
    const state = await transition(tx, {
      bookingId: b.id,
      from: DISPUTABLE_STATES,
      to: "DISPUTED",
      actorId: i.actorId,
      reason: `dispute_${i.category}`,
      data: { disputeId: d.id, claimedPaise: i.claimedPaise },
    });
    return { state, disputeId: d.id };
  });
  await notifyUsers([otherParty(b, role)], "A dispute was raised", "Respond within 72 hours; a society admin will then rule.", link(b.id));
  await notifySocietyAdmins(b.societyId, "New BorrowVault dispute", `A ${i.category.replace("_", " ")} dispute needs a ruling.`, link(b.id));
  return out;
}

async function loadDispute(bookingId: string) {
  const [d] = await db.select().from(disputes).where(eq(disputes.bookingId, bookingId)).limit(1);
  if (!d) throw notFound("no dispute on this booking");
  return d;
}

/** Inline: the other party responds (optional settlement offer). No state change. */
export async function respondDispute(i: { bookingId: string; actorId: string; responseText: string; offerPaise?: number }) {
  const b = await loadBooking(i.bookingId);
  const role = partyOf(b, i.actorId);
  if (b.state !== "DISPUTED") throw conflict("no open dispute");
  const d = await loadDispute(b.id);
  if (d.raisedBy === i.actorId) throw forbidden("the other party responds to a dispute");
  if (i.offerPaise != null && i.offerPaise > d.claimedPaise) throw invalid("offer cannot exceed the claim");
  if (d.respondedAt) throw alreadySubmitted("already responded");
  const updated = await db
    .update(disputes)
    .set({
      responseText: i.responseText,
      responseOfferPaise: i.offerPaise ?? null,
      respondedAt: new Date(),
      status: d.status === "escalated" ? "escalated" : "under_review",
    })
    .where(and(eq(disputes.id, d.id), isNull(disputes.respondedAt)))
    .returning({ id: disputes.id });
  if (!updated.length) throw alreadySubmitted("already responded");
  await db.insert(disputeMessages).values({ disputeId: d.id, authorId: i.actorId, body: i.responseText });
  await notifyUsers([otherParty(b, role)], "Dispute response received", i.offerPaise != null ? "The other party made a settlement offer." : "The other party responded to your dispute.", link(b.id));
}

async function resolve(
  b: Booking,
  d: typeof disputes.$inferSelect,
  awardPaise: number,
  arbiterId: string | null,
  actorId: string,
  reason: string,
  note: string | null,
) {
  const p = await loadPayment(b.id);
  const raiser: PartyRole = d.raisedBy === b.lenderId ? "lender" : "borrower";
  let out: ResolutionOutcome = d.raisedBySystem
    ? // The system's "refund not confirmed" dispute (after COMPLETED or CANCELLED):
      // the ruling IS the amount the lender must still refund. No award debt.
      {
        depositStatus: awardPaise > 0 ? (p?.depositStatus ?? "none") : "released",
        refundDuePaise: awardPaise,
        awardPaise: 0,
        awardFromDepositPaise: 0,
        awardStatus: "none",
        awardPayer: null,
      }
    : depositProvider((p?.depositMode ?? "declared") as DepositMode).onResolved({
        depositPaise: b.depositPaise,
        awardPaise,
        raiser,
        raisedBySystem: false,
      });
  // Account for a refund the borrower already confirmed: only the remainder is still owed.
  const alreadyRefunded = p?.refundConfirmedAt ? p.refundDuePaise : 0;
  const due = netRefundDue(out.refundDuePaise, alreadyRefunded);
  const refundFields =
    alreadyRefunded > 0 && due === 0
      ? {} // fully refunded already: keep the confirmed record
      : { refundDuePaise: due, refundClaimedAt: null, refundConfirmedAt: null };
  out = { ...out, refundDuePaise: due };
  const payerId = out.awardPayer === "lender" ? b.lenderId : out.awardPayer === "borrower" ? b.borrowerId : null;
  const payeeId = payerId ? (payerId === b.lenderId ? b.borrowerId : b.lenderId) : null;

  const s = await db.transaction(async (tx) => {
    const s = await transition(tx, {
      bookingId: b.id,
      from: "DISPUTED",
      to: "RESOLVED",
      actorId,
      reason,
      data: { awardPaise, depositStatus: out.depositStatus, awardStatus: out.awardStatus },
    });
    await tx
      .update(disputes)
      .set({ status: "resolved", arbiterId, awardPaise, rulingNote: note, resolvedAt: new Date() })
      .where(eq(disputes.id, d.id));
    if (note) await tx.insert(disputeMessages).values({ disputeId: d.id, authorId: arbiterId, body: note });
    if (p) {
      await tx
        .update(bookingPayments)
        .set({
          depositStatus: out.depositStatus,
          ...refundFields,
          awardPaise: out.awardPaise,
          awardFromDepositPaise: out.awardFromDepositPaise,
          awardStatus: out.awardStatus,
          awardPayerId: payerId,
          awardPayeeId: payeeId,
          updatedAt: new Date(),
        })
        .where(eq(bookingPayments.bookingId, b.id));
    }
    return s;
  });
  await notifyUsers([b.lenderId, b.borrowerId], "Dispute resolved", `The dispute was resolved with an award of Rs ${(awardPaise / 100).toFixed(2)}.`, link(b.id));
  return s;
}

/** Activity: the raiser accepts the respondent's offer -> RESOLVED. */
export async function acceptOffer(i: { bookingId: string; actorId: string }): Promise<BookingState> {
  const b = await loadBooking(i.bookingId);
  partyOf(b, i.actorId);
  if (b.state !== "DISPUTED") throw conflict("no open dispute");
  const d = await loadDispute(b.id);
  if (d.raisedBy !== i.actorId) throw forbidden("only the party who raised the dispute can accept the offer");
  if (d.responseOfferPaise == null) throw conflict("there is no offer to accept");
  return resolve(b, d, d.responseOfferPaise, null, i.actorId, "settled_offer_accepted", null);
}

/** Activity: society admin (not a party, not the same unit) or platform admin rules -> RESOLVED. */
export async function rule(i: { bookingId: string; actorId: string; awardPaise: number; note: string }): Promise<BookingState> {
  const b = await loadBooking(i.bookingId);
  await assertArbiter(i.actorId, b);
  if (b.state !== "DISPUTED") throw conflict("no open dispute");
  const d = await loadDispute(b.id);
  if (i.awardPaise > d.claimedPaise) throw invalid("award cannot exceed the claim");
  return resolve(b, d, i.awardPaise, i.actorId, i.actorId, "arbiter_ruling", i.note);
}

// ---------------------------------------------------------------------------
// After COMPLETED / RESOLVED: refunds, awards, ratings (inline; no state change)
// ---------------------------------------------------------------------------

async function settlementPayment(b: Booking) {
  if (!["COMPLETED", "RESOLVED", "DISPUTED", "CANCELLED"].includes(b.state)) throw conflict(`nothing to settle while ${b.state}`);
  const p = await loadPayment(b.id);
  if (!p) throw conflict("nothing to settle");
  return p;
}

export async function refundClaim(i: { bookingId: string; actorId: string }) {
  const b = await loadBooking(i.bookingId);
  if (partyOf(b, i.actorId) !== "lender") throw forbidden("only the lender refunds");
  const p = await settlementPayment(b);
  if (p.refundDuePaise <= 0) throw conflict("no refund is due");
  if (p.refundConfirmedAt) throw alreadySubmitted("refund already confirmed");
  await db
    .update(bookingPayments)
    .set({ refundClaimedAt: new Date(), depositStatus: "refund_claimed", updatedAt: new Date() })
    .where(and(eq(bookingPayments.bookingId, b.id), isNull(bookingPayments.refundConfirmedAt)));
  await notifyUsers([b.borrowerId], "Refund sent", "The lender says they refunded you. Confirm once it arrives.", link(b.id));
}

/** Borrower confirms the refund arrived. The route then signals the workflow to stop its 24 h timer. */
export async function refundConfirm(i: { bookingId: string; actorId: string }): Promise<void> {
  const b = await loadBooking(i.bookingId);
  if (partyOf(b, i.actorId) !== "borrower") throw forbidden("only the borrower confirms the refund");
  // While a dispute is open the ruling decides what is owed; confirm after it.
  if (b.state === "DISPUTED") throw conflict("a dispute is open; confirm the refund after the ruling");
  const p = await settlementPayment(b);
  if (p.refundDuePaise <= 0) throw conflict("no refund is due");
  if (p.refundConfirmedAt) throw alreadySubmitted("refund already confirmed");
  await db
    .update(bookingPayments)
    .set({ refundConfirmedAt: new Date(), depositStatus: "refunded", updatedAt: new Date() })
    .where(and(eq(bookingPayments.bookingId, b.id), isNull(bookingPayments.refundConfirmedAt)));
}

export async function awardPaidClaim(i: { bookingId: string; actorId: string }) {
  const b = await loadBooking(i.bookingId);
  partyOf(b, i.actorId);
  const p = await settlementPayment(b);
  if (p.awardPayerId !== i.actorId) throw forbidden("only the party who owes the award can mark it paid");
  if (p.awardStatus !== "debt_recorded") throw conflict(`award is ${p.awardStatus}`);
  await db
    .update(bookingPayments)
    .set({ awardStatus: "paid_claimed", awardClaimedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(bookingPayments.bookingId, b.id), eq(bookingPayments.awardStatus, "debt_recorded")));
  if (p.awardPayeeId) await notifyUsers([p.awardPayeeId], "Award marked as paid", "Confirm once the UPI payment arrives.", link(b.id));
}

export async function awardPaidConfirm(i: { bookingId: string; actorId: string }) {
  const b = await loadBooking(i.bookingId);
  partyOf(b, i.actorId);
  const p = await settlementPayment(b);
  if (p.awardPayeeId !== i.actorId) throw forbidden("only the party owed the award can confirm it");
  if (p.awardStatus !== "paid_claimed" && p.awardStatus !== "debt_recorded") throw conflict(`award is ${p.awardStatus}`);
  await db
    .update(bookingPayments)
    .set({ awardStatus: "paid", awardConfirmedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(bookingPayments.bookingId, b.id), inArray(bookingPayments.awardStatus, ["paid_claimed", "debt_recorded"])));
}

export async function rate(i: {
  bookingId: string;
  actorId: string;
  stars: number;
  punctual?: boolean;
  careful?: boolean;
  asDescribed?: boolean;
  comment?: string;
}) {
  const b = await loadBooking(i.bookingId);
  const role = partyOf(b, i.actorId);
  if (b.state !== "COMPLETED" && b.state !== "RESOLVED") throw conflict("ratings open after the booking completes");
  const [r] = await db
    .insert(ratings)
    .values({
      bookingId: b.id,
      raterId: i.actorId,
      rateeId: otherParty(b, role),
      stars: i.stars,
      punctual: i.punctual ?? null,
      careful: i.careful ?? null,
      asDescribed: i.asDescribed ?? null,
      comment: i.comment ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!r) throw alreadySubmitted("already rated");
  await recomputeTrust(otherParty(b, role));
  return r;
}

// ---------------------------------------------------------------------------
// Trust (blueprint §4)
// ---------------------------------------------------------------------------

export async function recomputeTrust(userId: string): Promise<void> {
  const yearAgo = new Date(Date.now() - 365 * 24 * 3_600_000);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${ratings.stars}), 0)::int` })
    .from(ratings)
    .where(eq(ratings.rateeId, userId));
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(
      and(
        or(eq(bookings.lenderId, userId), eq(bookings.borrowerId, userId)),
        inArray(bookings.state, ["COMPLETED", "RESOLVED"]),
      ),
    );
  // Lost = an award > 0 against you, i.e. you were the party who did NOT raise it.
  const [lost] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(disputes)
    .innerJoin(bookings, eq(bookings.id, disputes.bookingId))
    .where(
      and(
        eq(disputes.status, "resolved"),
        gt(disputes.awardPaise, 0),
        gt(disputes.resolvedAt, yearAgo),
        ne(disputes.raisedBy, userId),
        or(eq(bookings.lenderId, userId), eq(bookings.borrowerId, userId)),
      ),
    );
  // Overdue returns, except those caused by a late handover (the overdue clock
  // was extended past endsAt because activation came within 1 h of it).
  const overdueRows = await db
    .select({
      endsAt: bookings.endsAt,
      activatedAt: sql<Date | null>`(select min(e2.at) from ${bookingEvents} e2 where e2.booking_id = ${bookings.id} and e2.to_state = 'ACTIVE')`,
    })
    .from(bookingEvents)
    .innerJoin(bookings, eq(bookings.id, bookingEvents.bookingId))
    .where(and(eq(bookingEvents.toState, "OVERDUE"), eq(bookings.borrowerId, userId), gt(bookingEvents.at, yearAgo)));
  const od = {
    n: overdueRows.filter((r) =>
      overdueCountsAgainstTrust(r.endsAt.getTime(), r.activatedAt ? new Date(r.activatedAt).getTime() : null),
    ).length,
  };
  const [noShows] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookingEvents)
    .innerJoin(bookings, eq(bookings.id, bookingEvents.bookingId))
    .where(and(eq(bookingEvents.reason, LENDER_NO_SHOW_REASON), eq(bookings.lenderId, userId), gt(bookingEvents.at, yearAgo)));

  const score = computeTrustScore({
    ratingsCount: r.n,
    starsSum: r.sum,
    disputesLost12mo: lost.n,
    overdue12mo: od.n,
    noShows12mo: noShows.n,
    completed: c.n,
  });
  await db
    .update(users)
    .set({ trustScore: score, trustCompleted: c.n, trustDisputesLost: lost.n })
    .where(eq(users.id, userId));
}

export async function recomputeTrustForBooking(i: { bookingId: string }): Promise<void> {
  const b = await loadBooking(i.bookingId);
  await recomputeTrust(b.lenderId);
  await recomputeTrust(b.borrowerId);
}

// ---------------------------------------------------------------------------
// Reconciliation (workflow update retries)
// ---------------------------------------------------------------------------

export type ReconcileAction =
  | "accept"
  | "decline"
  | "cancel"
  | "confirmPayment"
  | "submitInspection"
  | "ackInspection"
  | "raiseDispute"
  | "acceptOffer"
  | "ruling";

const EVENT_REASON: Partial<Record<ReconcileAction, (r: string) => boolean>> = {
  accept: (r) => r === "lender_accepted",
  decline: (r) => r === "lender_declined",
  cancel: (r) => r.endsWith("_cancelled"),
  confirmPayment: (r) => r === "lender_confirmed_payment",
  acceptOffer: (r) => r === "settled_offer_accepted",
  ruling: (r) => r === "arbiter_ruling",
};

/**
 * After an update's activity fails with TRANSITION_CONFLICT / ALREADY_SUBMITTED
 * (or exhausts retries), the effect may already be committed: e.g. the activity
 * committed but its result was lost and the retry hit its own change. Report the
 * DB's current state and whether THIS actor's requested action is already
 * reflected, so the update can succeed idempotently instead of 409ing.
 */
export async function reconcileAction(i: {
  bookingId: string;
  actorId: string;
  action: ReconcileAction;
  phase?: "handover" | "return";
  result?: "agreed" | "objected";
}): Promise<{ state: BookingState; applied: boolean; disputeId?: string }> {
  const b = await loadBooking(i.bookingId);
  const reasonOk = EVENT_REASON[i.action];
  if (reasonOk) {
    const evs = await db
      .select({ reason: bookingEvents.reason })
      .from(bookingEvents)
      .where(and(eq(bookingEvents.bookingId, b.id), eq(bookingEvents.actorId, i.actorId)));
    return { state: b.state, applied: evs.some((e) => reasonOk(e.reason)) };
  }
  if (i.action === "submitInspection" && i.phase) {
    const [x] = await db
      .select({ id: inspections.id })
      .from(inspections)
      .where(and(eq(inspections.bookingId, b.id), eq(inspections.phase, i.phase), eq(inspections.submittedBy, i.actorId)));
    return { state: b.state, applied: Boolean(x) };
  }
  if (i.action === "ackInspection" && i.phase && i.result) {
    const [x] = await db
      .select({ id: inspections.id })
      .from(inspections)
      .where(
        and(
          eq(inspections.bookingId, b.id),
          eq(inspections.phase, i.phase),
          eq(inspections.ackBy, i.actorId),
          eq(inspections.ackResult, i.result),
        ),
      );
    return { state: b.state, applied: Boolean(x) };
  }
  if (i.action === "raiseDispute") {
    const [d] = await db
      .select({ id: disputes.id })
      .from(disputes)
      .where(and(eq(disputes.bookingId, b.id), eq(disputes.raisedBy, i.actorId), eq(disputes.raisedBySystem, false)));
    return { state: b.state, applied: Boolean(d), ...(d ? { disputeId: d.id } : {}) };
  }
  return { state: b.state, applied: false };
}
