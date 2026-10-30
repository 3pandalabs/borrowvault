// Pure: no DB/env imports, so unit tests and the Temporal workflow bundle can
// use it. The workflow sandbox must never import db/ or env.

export const BOOKING_STATES = [
  "REQUESTED",
  "ACCEPTED",
  "DEPOSIT_HELD",
  "HANDOVER_PENDING",
  "ACTIVE",
  "OVERDUE",
  "RETURN_PENDING",
  "COMPLETED",
  "DISPUTED",
  "RESOLVED",
  "DECLINED",
  "EXPIRED",
  "CANCELLED",
] as const;

export type BookingState = (typeof BOOKING_STATES)[number];

// infra/blueprint.md §5, plus Phase 1's refund timeout: COMPLETED/CANCELLED ->
// DISPUTED, raised by the SYSTEM on the borrower's behalf when a refund that is
// due isn't confirmed within 24 h. Anything not listed is rejected.
export const ALLOWED: Record<BookingState, readonly BookingState[]> = {
  REQUESTED: ["ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED"],
  ACCEPTED: ["DEPOSIT_HELD", "EXPIRED", "CANCELLED"],
  DEPOSIT_HELD: ["HANDOVER_PENDING", "CANCELLED"],
  HANDOVER_PENDING: ["ACTIVE", "CANCELLED", "DISPUTED"],
  ACTIVE: ["OVERDUE", "RETURN_PENDING", "DISPUTED"],
  OVERDUE: ["RETURN_PENDING", "DISPUTED"],
  RETURN_PENDING: ["COMPLETED", "DISPUTED"],
  COMPLETED: ["DISPUTED"],
  DISPUTED: ["RESOLVED"],
  RESOLVED: [],
  DECLINED: [],
  EXPIRED: [],
  CANCELLED: ["DISPUTED"],
};

/** Moves only the system (actorId = null) may make. */
export const SYSTEM_ONLY: readonly (readonly [BookingState, BookingState])[] = [
  ["COMPLETED", "DISPUTED"],
  ["CANCELLED", "DISPUTED"],
];

export function isSystemOnly(from: BookingState, to: BookingState): boolean {
  return SYSTEM_ONLY.some(([f, t]) => f === from && t === to);
}

export const TERMINAL_STATES: readonly BookingState[] = ["RESOLVED", "DECLINED", "EXPIRED", "CANCELLED"];

// States in which the item is committed to this booking. Mirrors the WHERE
// clause of the bookings_no_overlap EXCLUDE constraint; keep them in sync.
export const OCCUPYING_STATES: readonly BookingState[] = [
  "ACCEPTED",
  "DEPOSIT_HELD",
  "HANDOVER_PENDING",
  "ACTIVE",
  "OVERDUE",
  "RETURN_PENDING",
];

export const CANCELLABLE_STATES: readonly BookingState[] = ["REQUESTED", "ACCEPTED", "DEPOSIT_HELD", "HANDOVER_PENDING"];
export const DISPUTABLE_STATES: readonly BookingState[] = ["HANDOVER_PENDING", "ACTIVE", "OVERDUE", "RETURN_PENDING"];

export function isAllowed(from: BookingState, to: BookingState): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export const HOUR_MS = 3_600_000;

// Timer durations (api/ROUTES.md "Timers"). Shared by the workflow and by
// nextAction/deadlineAt so the deadline a client shows is the one that fires.
export const TIMERS = {
  requestedMs: 12 * HOUR_MS,
  acceptedMs: 2 * HOUR_MS,
  handoverOpensBeforeStartMs: 1 * HOUR_MS,
  handoverTimeoutAfterStartMs: 24 * HOUR_MS,
  overdueNudgeHours: [1, 6, 24] as readonly number[],
  overdueAdminAlertHours: 48,
  returnReviewMs: 24 * HOUR_MS,
  disputeEscalateMs: 72 * HOUR_MS,
  p2pRefundMs: 24 * HOUR_MS,
  /** Minimum rental time after a (late) handover before the booking can go OVERDUE. */
  minRentalAfterHandoverMs: 1 * HOUR_MS,
};

/**
 * The overdue clock: max(endsAt, activatedAt + 1 h). A handover that happens
 * late (or after endsAt) still gets an hour before the booking goes OVERDUE.
 */
export function overdueAt(endsAtMs: number, activatedAtMs: number | null): number {
  if (activatedAtMs == null) return endsAtMs;
  return Math.max(endsAtMs, activatedAtMs + TIMERS.minRentalAfterHandoverMs);
}

/** An OVERDUE caused by a late handover (clock extended past endsAt) carries no trust penalty. */
export function overdueCountsAgainstTrust(endsAtMs: number, activatedAtMs: number | null): boolean {
  return overdueAt(endsAtMs, activatedAtMs) === endsAtMs && (activatedAtMs == null || activatedAtMs + TIMERS.minRentalAfterHandoverMs <= endsAtMs);
}
