import { ApplicationFailure } from "@temporalio/common";
import { ERROR_STATUS, isErrorCode } from "../lib/errors.js";

export interface HttpFailure {
  status: number;
  body: { error: string; code?: string };
}

// Activities throw ApplicationFailure with `type` = a DomainError code
// (TRANSITION_CONFLICT, FORBIDDEN, VALIDATION, NOT_FOUND, OVERLAP,
// ALREADY_SUBMITTED). Walk the cause chain (UpdateFailed -> ApplicationFailure,
// or WorkflowFailed -> ActivityFailure -> ApplicationFailure) and map it.
function findApplicationFailure(err: unknown): ApplicationFailure | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 8 && cur instanceof Error; i++) {
    if (cur instanceof ApplicationFailure) return cur;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

export function toHttpFailure(err: unknown): HttpFailure {
  const app = findApplicationFailure(err);
  if (app?.type && isErrorCode(app.type)) {
    return { status: ERROR_STATUS[app.type], body: { error: app.message || app.type, code: app.type } };
  }
  const name = (err as { name?: string })?.name ?? "";
  const message = (err as { message?: string })?.message ?? "";
  // The booking's workflow has finished (terminal state) or never started.
  if (name === "WorkflowNotFoundError" || /already completed|not found/i.test(message)) {
    return { status: 409, body: { error: "this booking no longer accepts that action", code: "TRANSITION_CONFLICT" } };
  }
  if (name === "WorkflowTimeout") {
    return { status: 503, body: { error: "booking service is busy, try again", code: "UNAVAILABLE" } };
  }
  return { status: 500, body: { error: "internal_error" } };
}
