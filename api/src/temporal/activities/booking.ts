import { ApplicationFailure } from "@temporalio/common";
import * as svc from "../../booking/service.js";
import type { BookingState } from "../../booking/states.js";
import { DomainError } from "../../lib/errors.js";

// Thin activity wrappers over booking/service.ts. A DomainError becomes a
// NON-retryable ApplicationFailure whose `type` is the error code, so the
// workflow update fails fast and the API maps it to the right HTTP status
// (TRANSITION_CONFLICT -> 409, FORBIDDEN -> 403, VALIDATION -> 400,
// NOT_FOUND -> 404, OVERLAP/ALREADY_SUBMITTED -> 409). Anything else (DB
// blip, R2 hiccup) is retried by Temporal; every service function is
// idempotent or guarded by transition()'s conditional update.

function wrap<A extends unknown[], R>(fn: (...a: A) => Promise<R>): (...a: A) => Promise<R> {
  return async (...a: A) => {
    try {
      return await fn(...a);
    } catch (err) {
      if (err instanceof DomainError) {
        throw ApplicationFailure.create({ type: err.code, message: err.message, nonRetryable: true });
      }
      throw err;
    }
  };
}

type Actor = { bookingId: string; actorId: string };

// --- actions (driven by workflow updates) ---
export const acceptBooking = wrap((i: Actor): Promise<BookingState> => svc.accept(i));
export const declineBooking = wrap((i: Actor): Promise<BookingState> => svc.decline(i));
export const cancelBooking = wrap((i: Actor): Promise<BookingState> => svc.cancel(i));
export const confirmBookingPayment = wrap((i: Actor): Promise<BookingState> => svc.confirmPayment(i));
export const submitInspection = wrap((i: svc.InspectionInput): Promise<BookingState> => svc.submitInspection(i));
export const ackInspection = wrap((i: svc.AckInput): Promise<BookingState> => svc.ackInspection(i));
export const raiseDispute = wrap((i: svc.DisputeInput) => svc.raiseDispute(i));
export const acceptDisputeOffer = wrap((i: Actor): Promise<BookingState> => svc.acceptOffer(i));
export const ruleDispute = wrap(
  (i: Actor & { awardPaise: number; note: string }): Promise<BookingState> => svc.rule(i),
);

// --- timers (driven by the workflow's own clock) ---
export const expireBooking = wrap((i: { bookingId: string; from: "REQUESTED" | "ACCEPTED" }) => svc.expire(i));
export const openHandover = wrap((i: { bookingId: string }) => svc.openHandover(i));
export const handoverTimeout = wrap((i: { bookingId: string }) => svc.handoverTimeout(i));
export const markOverdue = wrap((i: { bookingId: string }) => svc.markOverdue(i));
export const nudgeOverdue = wrap((i: { bookingId: string; hoursLate: number; alertAdmins: boolean }) => svc.nudgeOverdue(i));
export const autoComplete = wrap((i: { bookingId: string }) => svc.autoComplete(i));
export const escalateDispute = wrap((i: { bookingId: string }) => svc.escalateDispute(i));
export const refundOutstanding = wrap((i: { bookingId: string }) => svc.refundOutstanding(i));
export const autoDisputeIfUnrefunded = wrap((i: { bookingId: string }) => svc.autoDisputeIfUnrefunded(i));
export const recomputeTrust = wrap((i: { bookingId: string }) => svc.recomputeTrustForBooking(i));

// --- reconciliation (DB is the source of truth when an update's result is lost) ---
export const currentState = wrap((i: { bookingId: string }) => svc.currentState(i.bookingId));
export const reconcileAction = wrap((i: Parameters<typeof svc.reconcileAction>[0]) => svc.reconcileAction(i));
