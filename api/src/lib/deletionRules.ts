// Pure account-deletion rules (api/ROUTES.md "Account deletion"). No DB/env
// imports so unit tests load it directly.

export type DeletionBlockerKind = "live_booking" | "open_dispute" | "unpaid_award" | "refund_owed";
export type DeletionBlocker = { kind: DeletionBlockerKind; bookingId: string; listingTitle: string; state: string };

/** Bookings that still need the person (same list as chat's live states, minus DISPUTED). */
export const LIVE_STATES = ["REQUESTED", "ACCEPTED", "DEPOSIT_HELD", "HANDOVER_PENDING", "ACTIVE", "OVERDUE", "RETURN_PENDING"];

export type BookingForDeletion = {
  bookingId: string;
  state: string;
  listingTitle: string;
  awardStatus: string | null;
  awardPayerId: string | null;
  awardPayeeId: string | null;
  refundDuePaise: number | null;
  refundConfirmedAt: Date | null;
};

/** One blocker per booking (the most pressing one), in input order. */
export function deletionBlockers(rows: BookingForDeletion[], userId: string): DeletionBlocker[] {
  const out: DeletionBlocker[] = [];
  for (const r of rows) {
    const base = { bookingId: r.bookingId, listingTitle: r.listingTitle, state: r.state };
    if (LIVE_STATES.includes(r.state)) out.push({ kind: "live_booking", ...base });
    else if (r.state === "DISPUTED") out.push({ kind: "open_dispute", ...base });
    else if (
      (r.awardStatus === "debt_recorded" || r.awardStatus === "paid_claimed") &&
      (r.awardPayerId === userId || r.awardPayeeId === userId)
    ) {
      out.push({ kind: "unpaid_award", ...base });
    } else if (["COMPLETED", "CANCELLED", "RESOLVED"].includes(r.state) && (r.refundDuePaise ?? 0) > 0 && !r.refundConfirmedAt) {
      out.push({ kind: "refund_owed", ...base });
    }
  }
  return out;
}
