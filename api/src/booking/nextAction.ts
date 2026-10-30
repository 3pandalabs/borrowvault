import { overdueAt, TIMERS, type BookingState } from "./states.js";

// Pure: derives the caller's next step + the deadline of the timer that will
// fire if nobody acts, so web/app never re-derive the state machine.
// Values are the closed list in api/ROUTES.md.

export type NextAction =
  | "accept_or_decline"
  | "wait_lender"
  | "pay"
  | "confirm_payment"
  | "wait_payment"
  | "handover_inspect"
  | "handover_ack"
  | "wait_handover"
  | "return_inspect"
  | "review_return"
  | "wait_review"
  | "respond_dispute"
  | "wait_ruling"
  | "refund_deposit"
  | "confirm_refund"
  | "pay_award"
  | "confirm_award"
  | "rate";

export type Role = "lender" | "borrower" | "admin";
type PartyRole = "lender" | "borrower";

export type NextActionInput = {
  state: BookingState;
  role: Role;
  stateChangedAt: Date;
  startsAt: Date;
  endsAt: Date;
  inspections: { phase: "handover" | "return"; party: PartyRole; ackResult: string | null }[];
  dispute: {
    raisedByRole: PartyRole;
    responded: boolean;
    createdAt: Date;
    escalated: boolean;
    resolved: boolean;
  } | null;
  payment: {
    depositMode: "declared" | "p2p";
    claimedAt: Date | null;
    refundDuePaise: number;
    refundClaimedAt: Date | null;
    refundConfirmedAt: Date | null;
    awardStatus: "none" | "debt_recorded" | "settled_from_deposit" | "paid_claimed" | "paid";
    awardPayerRole: PartyRole | null;
  } | null;
  ratedByMe: boolean;
};

export type NextActionResult = { nextAction: NextAction | null; deadlineAt: Date | null };

const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

function find(i: NextActionInput, phase: "handover" | "return", party: PartyRole) {
  return i.inspections.find((x) => x.phase === phase && x.party === party) ?? null;
}

function refundOpen(p: NonNullable<NextActionInput["payment"]>): boolean {
  return p.refundDuePaise > 0 && !p.refundConfirmedAt;
}

/** Refund step only (CANCELLED after payment): no rating on a cancelled booking. */
function refundStep(i: NextActionInput, role: PartyRole): NextAction | null {
  const p = i.payment;
  if (!p || !refundOpen(p)) return null;
  if (role === "lender" && !p.refundClaimedAt) return "refund_deposit";
  if (role === "borrower" && p.refundClaimedAt) return "confirm_refund";
  return null;
}

function afterwards(i: NextActionInput, role: PartyRole): NextAction | null {
  const p = i.payment;
  if (p) {
    if (refundOpen(p)) {
      if (role === "lender" && !p.refundClaimedAt) return "refund_deposit";
      if (role === "borrower" && p.refundClaimedAt) return "confirm_refund";
    }
    if (p.awardPayerRole) {
      const payer = p.awardPayerRole === role;
      if (payer && p.awardStatus === "debt_recorded") return "pay_award";
      if (!payer && p.awardStatus === "paid_claimed") return "confirm_award";
    }
  }
  return i.ratedByMe ? null : "rate";
}

export function computeNextAction(i: NextActionInput): NextActionResult {
  const { state, role } = i;
  const none = (deadlineAt: Date | null = null): NextActionResult => ({ nextAction: null, deadlineAt });

  switch (state) {
    case "REQUESTED": {
      const deadlineAt = plus(i.stateChangedAt, TIMERS.requestedMs);
      if (role === "lender") return { nextAction: "accept_or_decline", deadlineAt };
      if (role === "borrower") return { nextAction: "wait_lender", deadlineAt };
      return none(deadlineAt);
    }
    case "ACCEPTED": {
      const deadlineAt = plus(i.stateChangedAt, TIMERS.acceptedMs);
      const claimed = Boolean(i.payment?.claimedAt);
      if (role === "borrower") return { nextAction: claimed ? "wait_payment" : "pay", deadlineAt };
      if (role === "lender") return { nextAction: claimed ? "confirm_payment" : "wait_payment", deadlineAt };
      return none(deadlineAt);
    }
    case "DEPOSIT_HELD":
      // Nothing to do until the handover window opens (startsAt - 1 h).
      return none(plus(i.startsAt, -TIMERS.handoverOpensBeforeStartMs));
    case "HANDOVER_PENDING": {
      const deadlineAt = plus(i.startsAt, TIMERS.handoverTimeoutAfterStartMs);
      const mine = role === "admin" ? null : find(i, "handover", role);
      if (role === "lender") return { nextAction: mine ? "wait_handover" : "handover_inspect", deadlineAt };
      if (role === "borrower") {
        if (!mine) return { nextAction: "handover_inspect", deadlineAt };
        const lenders = find(i, "handover", "lender");
        if (lenders && !lenders.ackResult) return { nextAction: "handover_ack", deadlineAt };
        return { nextAction: "wait_handover", deadlineAt };
      }
      return none(deadlineAt);
    }
    case "ACTIVE": {
      // Overdue clock: max(endsAt, activatedAt + 1 h); a late handover still gets an hour.
      const deadlineAt = new Date(overdueAt(i.endsAt.getTime(), i.stateChangedAt.getTime()));
      return { nextAction: role === "borrower" ? "return_inspect" : null, deadlineAt };
    }
    case "OVERDUE":
      return { nextAction: role === "borrower" ? "return_inspect" : null, deadlineAt: null };
    case "RETURN_PENDING": {
      const deadlineAt = plus(i.stateChangedAt, TIMERS.returnReviewMs);
      if (role === "lender") {
        const borrowers = find(i, "return", "borrower");
        // Not yet acked, or objected (must now raise a dispute within the same 24 h window).
        return { nextAction: borrowers && borrowers.ackResult !== "agreed" ? "review_return" : null, deadlineAt };
      }
      if (role === "borrower") return { nextAction: "wait_review", deadlineAt };
      return none(deadlineAt);
    }
    case "DISPUTED": {
      const d = i.dispute;
      const deadlineAt = d && !d.escalated ? plus(d.createdAt, TIMERS.disputeEscalateMs) : null;
      if (role === "admin" || !d) return none(deadlineAt);
      if (role !== d.raisedByRole && !d.responded) return { nextAction: "respond_dispute", deadlineAt };
      return { nextAction: "wait_ruling", deadlineAt };
    }
    case "COMPLETED": {
      const p = i.payment;
      const deadlineAt = p && refundOpen(p) ? plus(i.stateChangedAt, TIMERS.p2pRefundMs) : null;
      if (role === "admin") return none(deadlineAt);
      return { nextAction: afterwards(i, role), deadlineAt };
    }
    case "CANCELLED": {
      // Cancelled after the lender confirmed payment: the lender owes a refund
      // (fee, + deposit in p2p) within 24 h, else the system opens a dispute.
      const p = i.payment;
      const deadlineAt = p && refundOpen(p) ? plus(i.stateChangedAt, TIMERS.p2pRefundMs) : null;
      if (role === "admin") return none(deadlineAt);
      return { nextAction: refundStep(i, role), deadlineAt };
    }
    case "RESOLVED":
      if (role === "admin") return none();
      return { nextAction: afterwards(i, role), deadlineAt: null };
    default:
      return none();
  }
}
