import {
  ActivityFailure,
  ApplicationFailure,
  allHandlersFinished,
  condition,
  defineQuery,
  defineSignal,
  defineUpdate,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type * as acts from "../activities/index.js";
import { HOUR_MS, overdueAt, TIMERS, type BookingState } from "../../booking/states.js";

// One long-running workflow per booking: id `booking-<uuid>`, task queue
// `borrowvault`. Postgres owns booking state (transition() is the only writer);
// this workflow owns TIME and RETRIES. It mirrors the state returned by each
// activity and runs the timers from api/ROUTES.md:
//
//   REQUESTED        12 h                              -> EXPIRED
//   ACCEPTED         2 h, no lender confirm            -> EXPIRED
//   DEPOSIT_HELD     at startsAt - 1 h                 -> HANDOVER_PENDING (skills -> ACTIVE)
//   HANDOVER_PENDING at startsAt + 24 h                -> CANCELLED (+ refund if paid, lender no-show strike)
//   ACTIVE           at max(endsAt, activatedAt + 1 h) -> OVERDUE; nudges +1/+6/+24 h, admin alert +48 h
//   RETURN_PENDING   24 h lender silence               -> COMPLETED
//   DISPUTED         72 h                              -> escalated (platform admins notified)
//   COMPLETED / CANCELLED with a refund owed: 24 h without refund-confirm -> DISPUTED (system, "late")
//
// Drift protection: if an update's activity committed but its result was lost,
// the retry hits its own change (409/ALREADY_SUBMITTED). The handler then asks
// the DB (reconcileAction) and succeeds idempotently if the action is already
// reflected. Unbounded waits (OVERDUE, escalated DISPUTED) re-read the DB hourly.
//
// Deterministic: only condition() timers and workflow Date.now() (replay-safe
// inside the sandbox). No I/O, no randomness.

export type BookingWorkflowInput = { bookingId: string; startsAt: number; endsAt: number };

type Result = { state: BookingState; disputeId?: string };
type ActorIn = { actorId: string };
type InspectionIn = Omit<Parameters<typeof acts.submitInspection>[0], "bookingId">;
type AckIn = Omit<Parameters<typeof acts.ackInspection>[0], "bookingId">;
type DisputeIn = Omit<Parameters<typeof acts.raiseDispute>[0], "bookingId">;
type RulingIn = ActorIn & { awardPaise: number; note: string };

export const acceptUpdate = defineUpdate<Result, [ActorIn]>("accept");
export const declineUpdate = defineUpdate<Result, [ActorIn]>("decline");
export const cancelUpdate = defineUpdate<Result, [ActorIn]>("cancel");
export const confirmPaymentUpdate = defineUpdate<Result, [ActorIn]>("confirmPayment");
export const submitInspectionUpdate = defineUpdate<Result, [InspectionIn]>("submitInspection");
export const ackInspectionUpdate = defineUpdate<Result, [AckIn]>("ackInspection");
export const raiseDisputeUpdate = defineUpdate<Result, [DisputeIn]>("raiseDispute");
export const acceptOfferUpdate = defineUpdate<Result, [ActorIn]>("acceptOffer");
export const rulingUpdate = defineUpdate<Result, [RulingIn]>("ruling");

// Signal from the inline refund-confirm route: stops the 24 h refund timer.
export const refundConfirmedSignal = defineSignal("refundConfirmed");
export const stateQuery = defineQuery<BookingState>("state");

// User-facing actions: few retries, so a broken dependency fails the HTTP call fast.
const ui = proxyActivities<typeof acts>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3, initialInterval: "1s", backoffCoefficient: 2 },
});

// Timer side effects and reconciliation: must eventually happen, so retry patiently.
const bg = proxyActivities<typeof acts>({
  startToCloseTimeout: "1 minute",
  retry: { initialInterval: "5s", backoffCoefficient: 2, maximumInterval: "10 minutes" },
});

// Domain failures that mean "the request itself was wrong": never reconcile these.
const NO_RECONCILE = new Set(["FORBIDDEN", "VALIDATION", "NOT_FOUND", "OVERLAP", "WINDOW_PASSED", "CONFLICT"]);

function appFailure(err: unknown): ApplicationFailure | null {
  if (err instanceof ApplicationFailure) return err;
  if (err instanceof ActivityFailure && err.cause instanceof ApplicationFailure) return err.cause;
  return null;
}

export async function bookingWorkflow(input: BookingWorkflowInput): Promise<BookingState> {
  const { bookingId, startsAt, endsAt } = input;
  let state = "REQUESTED" as BookingState;
  // Read through a function: handlers mutate `state` concurrently, so TS narrowing must not apply.
  const cur = (): BookingState => state;
  let enteredAt = Date.now();
  let refundConfirmed = false;

  const set = (s: BookingState) => {
    if (s !== state) {
      state = s;
      enteredAt = Date.now();
    }
  };

  /**
   * Wraps an update: run the action activity; on a conflict-type failure, ask
   * the DB whether this actor's action is already reflected (idempotent
   * success) and always resync the mirrored state.
   */
  const handle =
    <I extends ActorIn & { phase?: "handover" | "return"; result?: "agreed" | "objected" }>(
      action: Parameters<typeof acts.reconcileAction>[0]["action"],
      call: (i: I & { bookingId: string }) => Promise<BookingState | Result>,
    ) =>
    async (a: I): Promise<Result> => {
      try {
        const r = await call({ ...a, bookingId });
        const res: Result = typeof r === "string" ? { state: r } : r;
        set(res.state);
        return res;
      } catch (err) {
        const app = appFailure(err);
        if (app?.type && NO_RECONCILE.has(app.type)) throw app;
        const rec = await bg.reconcileAction({ bookingId, actorId: a.actorId, action, phase: a.phase, result: a.result });
        set(rec.state);
        if (rec.applied) return { state: rec.state, ...(rec.disputeId ? { disputeId: rec.disputeId } : {}) };
        throw app ?? err;
      }
    };

  setHandler(acceptUpdate, handle<ActorIn>("accept", ui.acceptBooking));
  setHandler(declineUpdate, handle<ActorIn>("decline", ui.declineBooking));
  setHandler(cancelUpdate, handle<ActorIn>("cancel", ui.cancelBooking));
  setHandler(confirmPaymentUpdate, handle<ActorIn>("confirmPayment", ui.confirmBookingPayment));
  setHandler(acceptOfferUpdate, handle<ActorIn>("acceptOffer", ui.acceptDisputeOffer));
  setHandler(rulingUpdate, handle<RulingIn>("ruling", ui.ruleDispute));
  setHandler(submitInspectionUpdate, handle<InspectionIn>("submitInspection", ui.submitInspection));
  setHandler(ackInspectionUpdate, handle<AckIn>("ackInspection", ui.ackInspection));
  setHandler(raiseDisputeUpdate, handle<DisputeIn>("raiseDispute", ui.raiseDispute));
  setHandler(refundConfirmedSignal, () => {
    refundConfirmed = true;
  });
  setHandler(stateQuery, () => state);

  const now = () => Date.now();

  /** Wait until the state changes or `ms` elapses. true = state changed. */
  const leaves = async (s: BookingState, ms: number): Promise<boolean> => {
    if (ms <= 0) return cur() !== s;
    return condition(() => cur() !== s, ms);
  };

  /**
   * Like `leaves`, but never trusts the in-memory mirror for more than an hour:
   * re-reads the DB state between chunks. Used for the long/unbounded waits.
   * `untilMs` = absolute deadline (Infinity = no deadline).
   */
  const leavesRechecked = async (s: BookingState, untilMs: number): Promise<boolean> => {
    for (;;) {
      const remaining = untilMs - now();
      if (remaining <= 0) return cur() !== s;
      if (await leaves(s, Math.min(remaining, HOUR_MS))) return true;
      set(await bg.currentState({ bookingId }));
      if (cur() !== s) return true;
    }
  };

  /** COMPLETED/CANCELLED: wait up to 24 h for refund-confirm, else the system opens a "late" dispute. */
  const awaitRefund = async (s: BookingState) => {
    if (!(await bg.refundOutstanding({ bookingId }))) return;
    const settled = await condition(
      () => refundConfirmed || cur() !== s,
      Math.max(enteredAt + TIMERS.p2pRefundMs - now(), 1),
    );
    if (!settled) set(await bg.autoDisputeIfUnrefunded({ bookingId }));
  };

  const finish = async (): Promise<BookingState> => {
    await condition(allHandlersFinished);
    return cur();
  };

  for (;;) {
    switch (cur()) {
      case "REQUESTED":
        if (!(await leaves("REQUESTED", enteredAt + TIMERS.requestedMs - now()))) {
          set(await bg.expireBooking({ bookingId, from: "REQUESTED" }));
        }
        break;

      case "ACCEPTED":
        if (!(await leaves("ACCEPTED", enteredAt + TIMERS.acceptedMs - now()))) {
          set(await bg.expireBooking({ bookingId, from: "ACCEPTED" }));
        }
        break;

      case "DEPOSIT_HELD":
        if (!(await leaves("DEPOSIT_HELD", startsAt - TIMERS.handoverOpensBeforeStartMs - now()))) {
          set(await bg.openHandover({ bookingId }));
        }
        break;

      case "HANDOVER_PENDING":
        if (!(await leaves("HANDOVER_PENDING", startsAt + TIMERS.handoverTimeoutAfterStartMs - now()))) {
          set(await bg.handoverTimeout({ bookingId }));
        }
        break;

      case "ACTIVE": {
        // Overdue clock: max(endsAt, activatedAt + 1 h). enteredAt = when this
        // workflow saw ACTIVE, i.e. the activation (handover) time.
        const dueAt = overdueAt(endsAt, enteredAt);
        if (!(await leaves("ACTIVE", dueAt - now()))) {
          set(await bg.markOverdue({ bookingId }));
        }
        break;
      }

      case "OVERDUE": {
        const overdueSince = enteredAt;
        const schedule = [...TIMERS.overdueNudgeHours, TIMERS.overdueAdminAlertHours];
        let returned = false;
        for (const h of schedule) {
          if (await leavesRechecked("OVERDUE", overdueSince + h * HOUR_MS)) {
            returned = true;
            break;
          }
          await bg.nudgeOverdue({ bookingId, hoursLate: h, alertAdmins: h === TIMERS.overdueAdminAlertHours });
        }
        if (!returned) await leavesRechecked("OVERDUE", Infinity);
        break;
      }

      case "RETURN_PENDING":
        if (!(await leaves("RETURN_PENDING", enteredAt + TIMERS.returnReviewMs - now()))) {
          set(await bg.autoComplete({ bookingId }));
        }
        break;

      case "DISPUTED":
        if (!(await leavesRechecked("DISPUTED", enteredAt + TIMERS.disputeEscalateMs))) {
          await bg.escalateDispute({ bookingId });
          await leavesRechecked("DISPUTED", Infinity);
        }
        break;

      case "COMPLETED":
        await bg.recomputeTrust({ bookingId });
        await awaitRefund("COMPLETED");
        if (cur() === "COMPLETED") return finish();
        break;

      case "CANCELLED":
        // Cancelled after payment (by a party, or the handover timeout): the
        // lender owes a refund under the same 24 h timer.
        await awaitRefund("CANCELLED");
        if (cur() === "CANCELLED") return finish();
        break;

      case "RESOLVED":
        await bg.recomputeTrust({ bookingId });
        return finish();

      default:
        // DECLINED / EXPIRED, or anything this loop doesn't model: stop.
        return finish();
    }
  }
}
