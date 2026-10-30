import { buildUpiIntent } from "../lib/upi.js";

// DepositProvider: the seam between the booking flow and however money moves.
//
// Phase 1 (this file) is UPI intent links straight to the counter-party's VPA,
// with claim -> confirm taps. The platform never holds money. Two modes:
//   declared: no deposit money moves; a lost dispute becomes a recorded debt
//   p2p:      the borrower pays the deposit to the lender, who refunds it via UPI
//
// Phase 2 (UPI one-time-mandate block via a gateway) plugs in here as another
// provider and needs an Indian entity. No gateway code belongs in Phase 1.
// Pure: no DB/env, so it is unit-testable.

export type DepositMode = "declared" | "p2p";
export type DepositStatus =
  | "none"
  | "pending"
  | "declared"
  | "held_by_lender"
  | "refund_claimed"
  | "refunded"
  | "released";
export type AwardStatus = "none" | "debt_recorded" | "settled_from_deposit" | "paid_claimed" | "paid";

export type PartyRef = { id: string; displayName: string; upiVpa: string | null };

export type ResolutionOutcome = {
  depositStatus: DepositStatus;
  refundDuePaise: number;
  /** Total award. */
  awardPaise: number;
  /** Part of the award the lender kept out of a p2p deposit they hold. The rest is a UPI debt. */
  awardFromDepositPaise: number;
  awardStatus: AwardStatus;
  awardPayer: "lender" | "borrower" | null;
};

export interface DepositProvider {
  readonly mode: DepositMode;
  /** Largest claim a party may raise in a dispute. */
  claimCap(i: { raiser: "lender" | "borrower"; feePaise: number; depositPaise: number; replacementValuePaise: number | null }): number;
  /** UPI links the borrower opens after the lender accepts. */
  paymentIntents(i: { bookingId: string; lender: PartyRef; feePaise: number; depositPaise: number }): {
    feeUpiIntent: string | null;
    depositUpiIntent: string | null;
  };
  /** Deposit status once the lender confirms receipt of the fee (+ p2p deposit). */
  onPaymentConfirmed(depositPaise: number): DepositStatus;
  /** Deposit bookkeeping when the booking COMPLETES without a dispute. */
  onCompleted(depositPaise: number): { depositStatus: DepositStatus; refundDuePaise: number };
  /** Deposit + award bookkeeping on RESOLVED. */
  onResolved(i: {
    depositPaise: number;
    awardPaise: number;
    raiser: "lender" | "borrower";
    raisedBySystem: boolean;
  }): ResolutionOutcome;
}

function intent(vpa: string | null, name: string, amountPaise: number, bookingId: string, purpose: Parameters<typeof buildUpiIntent>[0]["purpose"]) {
  if (!vpa || amountPaise <= 0) return null;
  return buildUpiIntent({ vpa, name, amountPaise, bookingId, purpose });
}

/**
 * Claim cap (both modes): max(deposit, replacement value). A borrower may also
 * claim back what they paid (fee + deposit). Awards can exceed the deposit; the
 * excess is recorded as a debt and settled via award/paid-claim -> paid-confirm.
 */
function claimCap(i: { raiser: "lender" | "borrower"; feePaise: number; depositPaise: number; replacementValuePaise: number | null }) {
  const base = Math.max(i.depositPaise, i.replacementValuePaise ?? 0);
  return i.raiser === "borrower" ? Math.max(base, i.feePaise + i.depositPaise) : base;
}

const declared: DepositProvider = {
  mode: "declared",
  claimCap,
  paymentIntents: ({ bookingId, lender, feePaise }) => ({
    feeUpiIntent: intent(lender.upiVpa, lender.displayName, feePaise, bookingId, "rental fee"),
    depositUpiIntent: null,
  }),
  onPaymentConfirmed: (d) => (d > 0 ? "declared" : "none"),
  onCompleted: (d) => ({ depositStatus: d > 0 ? "released" : "none", refundDuePaise: 0 }),
  onResolved: ({ depositPaise, awardPaise, raiser }) => ({
    depositStatus: depositPaise > 0 ? "released" : "none",
    refundDuePaise: 0,
    awardPaise,
    awardFromDepositPaise: 0,
    awardStatus: awardPaise > 0 ? "debt_recorded" : "none",
    awardPayer: awardPaise > 0 ? (raiser === "lender" ? "borrower" : "lender") : null,
  }),
};

const p2p: DepositProvider = {
  mode: "p2p",
  claimCap,
  paymentIntents: ({ bookingId, lender, feePaise, depositPaise }) => ({
    feeUpiIntent: intent(lender.upiVpa, lender.displayName, feePaise, bookingId, "rental fee"),
    depositUpiIntent: intent(lender.upiVpa, lender.displayName, depositPaise, bookingId, "deposit"),
  }),
  onPaymentConfirmed: (d) => (d > 0 ? "held_by_lender" : "none"),
  onCompleted: (d) => ({ depositStatus: d > 0 ? "held_by_lender" : "none", refundDuePaise: d }),
  onResolved: ({ depositPaise, awardPaise, raiser, raisedBySystem }) => {
    const held = depositPaise > 0 ? "held_by_lender" : "none";
    if (raisedBySystem) {
      // The system's "deposit not refunded" dispute: the ruling IS the amount
      // the lender must still refund to the borrower.
      const due = Math.min(awardPaise, depositPaise);
      return { depositStatus: due > 0 ? held : "released", refundDuePaise: due, awardPaise: 0, awardFromDepositPaise: 0, awardStatus: "none", awardPayer: null };
    }
    if (raiser === "lender") {
      // Lender keeps up to the deposit they hold, refunds the rest of it, and
      // any award above the deposit becomes a UPI debt.
      const kept = Math.min(awardPaise, depositPaise);
      const due = depositPaise - kept;
      const debt = awardPaise - kept;
      return {
        depositStatus: due > 0 ? held : "released",
        refundDuePaise: due,
        awardPaise,
        awardFromDepositPaise: kept,
        awardStatus: debt > 0 ? "debt_recorded" : kept > 0 ? "settled_from_deposit" : "none",
        awardPayer: awardPaise > 0 ? "borrower" : null,
      };
    }
    // Borrower won against the lender: full deposit refund plus the award.
    return {
      depositStatus: held,
      refundDuePaise: depositPaise,
      awardPaise,
      awardFromDepositPaise: 0,
      awardStatus: awardPaise > 0 ? "debt_recorded" : "none",
      awardPayer: awardPaise > 0 ? "lender" : null,
    };
  },
};

export function depositProvider(mode: DepositMode): DepositProvider {
  return mode === "p2p" ? p2p : declared;
}

/** UPI link for whoever has to pay a refund/award, to the receiver's VPA. */
export function refundIntent(
  bookingId: string,
  borrower: PartyRef,
  amountPaise: number,
  purpose: "deposit refund" | "refund" = "deposit refund",
): string | null {
  return intent(borrower.upiVpa, borrower.displayName, amountPaise, bookingId, purpose);
}

export function awardIntent(bookingId: string, payee: PartyRef, amountPaise: number): string | null {
  return intent(payee.upiVpa, payee.displayName, amountPaise, bookingId, "dispute award");
}

/**
 * Refund owed to the borrower when a booking is CANCELLED (borrower/lender
 * cancel, or the 24 h handover timeout) after the lender confirmed receipt:
 * the fee, plus the deposit in p2p mode (declared deposits never moved).
 * Nothing is owed if payment was never confirmed.
 */
export function refundDueOnCancel(i: {
  depositMode: DepositMode;
  feePaise: number;
  depositPaise: number;
  paymentConfirmed: boolean;
}): { refundDuePaise: number; depositStatus: DepositStatus } {
  if (!i.paymentConfirmed) return { refundDuePaise: 0, depositStatus: "none" };
  const deposit = i.depositMode === "p2p" ? i.depositPaise : 0;
  return { refundDuePaise: i.feePaise + deposit, depositStatus: deposit > 0 ? "held_by_lender" : "released" };
}

/** Refund still owed after a ruling, given what the borrower already confirmed receiving. */
export function netRefundDue(ruledDuePaise: number, alreadyRefundedPaise: number): number {
  return Math.max(0, ruledDuePaise - alreadyRefundedPaise);
}
