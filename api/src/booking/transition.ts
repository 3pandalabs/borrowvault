import { and, eq, sql } from "drizzle-orm";
import { bookingEvents, bookings } from "../db/schema.js";
import type { Tx } from "../db/index.js";
import { DomainError } from "../lib/errors.js";
import { isAllowed, isSystemOnly, type BookingState } from "./states.js";

export { ALLOWED, type BookingState } from "./states.js";

/** The requested move is not in the ALLOWED map at all (a programming error or a forged request). */
export class IllegalTransition extends DomainError {
  constructor(
    public readonly fromState: BookingState,
    public readonly toState: BookingState,
  ) {
    super("TRANSITION_CONFLICT", `illegal transition ${fromState} -> ${toState}`);
  }
}

/** The booking is not (any longer) in the expected state: someone else moved it first. */
export class TransitionConflict extends DomainError {
  constructor(
    public readonly bookingId: string,
    public readonly expected: readonly BookingState[],
    public readonly toState: BookingState,
    public readonly actual: BookingState | null,
  ) {
    super(
      "TRANSITION_CONFLICT",
      `booking is ${actual ?? "missing"}; cannot move to ${toState} (expected ${expected.join("|")})`,
    );
  }
}

export type TransitionOpts = {
  bookingId: string;
  from: BookingState | readonly BookingState[];
  to: BookingState;
  actorId: string | null;
  reason: string;
  data?: Record<string, unknown>;
};

/**
 * THE ONLY WRITER OF bookings.state.
 *
 * Inside the caller's transaction: lock the row, check it's in an expected
 * state, conditional UPDATE (… WHERE state = <locked state>), and append a
 * booking_events row. Two taps, a timer and a retry can race; exactly one wins
 * and the others get TransitionConflict (HTTP 409).
 *
 * Always pass the surrounding transaction so side-table writes (payments,
 * disputes, inspections) commit or roll back together with the state change.
 */
export async function transition(tx: Pick<Tx, "select" | "update" | "insert">, opts: TransitionOpts): Promise<BookingState> {
  const from: readonly BookingState[] = typeof opts.from === "string" ? [opts.from] : opts.from;
  if (from.length === 0) throw new Error("transition(): `from` must not be empty");
  for (const f of from) {
    if (!isAllowed(f, opts.to)) throw new IllegalTransition(f, opts.to);
    // e.g. CANCELLED/COMPLETED -> DISPUTED: only the refund-timeout system dispute.
    if (opts.actorId !== null && isSystemOnly(f, opts.to)) throw new IllegalTransition(f, opts.to);
  }

  const [prev] = await tx
    .select({ state: bookings.state })
    .from(bookings)
    .where(eq(bookings.id, opts.bookingId))
    .for("update");
  if (!prev || !from.includes(prev.state)) {
    throw new TransitionConflict(opts.bookingId, from, opts.to, prev?.state ?? null);
  }

  const now = new Date();
  const updated = await tx
    .update(bookings)
    .set({ state: opts.to, stateChangedAt: now, updatedAt: now, version: sql`${bookings.version} + 1` })
    .where(and(eq(bookings.id, opts.bookingId), eq(bookings.state, prev.state)))
    .returning({ id: bookings.id });
  if (updated.length !== 1) {
    throw new TransitionConflict(opts.bookingId, from, opts.to, prev.state);
  }

  await tx.insert(bookingEvents).values({
    bookingId: opts.bookingId,
    fromState: prev.state,
    toState: opts.to,
    actorId: opts.actorId,
    reason: opts.reason,
    data: opts.data ?? {},
  });
  return opts.to;
}
