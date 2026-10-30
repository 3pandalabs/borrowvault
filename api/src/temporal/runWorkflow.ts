import { WorkflowIdReusePolicy } from "@temporalio/client";
import type { FastifyReply } from "fastify";
import { getTemporalClient } from "./client.js";
import { temporalEnv } from "./env.js";
import { toHttpFailure, type HttpFailure } from "./errors.js";

export type { HttpFailure } from "./errors.js";

export const bookingWorkflowId = (bookingId: string) => `booking-${bookingId}`;

// A dead worker must fail the HTTP request fast instead of hanging it.
const UPDATE_TIMEOUT_MS = 20_000;

/** Starts the one long-running workflow for a booking. Idempotent on the workflow id. */
export async function startBookingWorkflow(b: { id: string; startsAt: Date; endsAt: Date }): Promise<void> {
  const client = await getTemporalClient();
  await client.workflow.start("bookingWorkflow", {
    taskQueue: temporalEnv.taskQueue,
    workflowId: bookingWorkflowId(b.id),
    workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    args: [{ bookingId: b.id, startsAt: b.startsAt.getTime(), endsAt: b.endsAt.getTime() }],
  });
}

/**
 * Runs a booking action as a workflow UPDATE so the HTTP caller gets a
 * synchronous result (the activity's 409/403/400/404 comes straight back).
 */
export async function updateBooking<T>(bookingId: string, update: string, input: Record<string, unknown>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(bookingWorkflowId(bookingId));
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const e = new Error("update timed out");
        e.name = "WorkflowTimeout";
        reject(e);
      }, UPDATE_TIMEOUT_MS);
    });
    return await Promise.race([handle.executeUpdate<T, [Record<string, unknown>]>(update, { args: [input] }), timeout]);
  } catch (err) {
    throw toHttpFailure(err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Route helper: run the update and reply with its result or the mapped failure. */
export async function sendBookingUpdate(
  reply: FastifyReply,
  bookingId: string,
  update: string,
  input: Record<string, unknown>,
  onSuccess: () => Promise<unknown>,
): Promise<FastifyReply> {
  try {
    await updateBooking(bookingId, update, input);
  } catch (err) {
    const { status, body } = err as HttpFailure;
    return reply.code(status ?? 500).send(body ?? { error: "internal_error" });
  }
  return reply.code(200).send(await onSuccess());
}

/** Fire-and-forget signal; a finished workflow is fine (nothing left to wake). */
export async function signalBooking(bookingId: string, signal: string, log: (m: string) => void): Promise<void> {
  try {
    const client = await getTemporalClient();
    await client.workflow.getHandle(bookingWorkflowId(bookingId)).signal(signal);
  } catch (err) {
    log(`signal ${signal} to booking-${bookingId} not delivered: ${String(err)}`);
  }
}
