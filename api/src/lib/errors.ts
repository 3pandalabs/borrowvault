// Domain errors shared by inline routes and Temporal activities. The `code` is
// also the Temporal ApplicationFailure `type`, so one table maps both paths to
// HTTP (see temporal/errors.ts and index.ts's error handler).

export const ERROR_STATUS = {
  VALIDATION: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TRANSITION_CONFLICT: 409,
  OVERLAP: 409,
  ALREADY_SUBMITTED: 409,
  CONFLICT: 409,
  WINDOW_PASSED: 409,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = code;
  }
  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

export const notFound = (m = "not_found") => new DomainError("NOT_FOUND", m);
export const forbidden = (m = "forbidden") => new DomainError("FORBIDDEN", m);
export const invalid = (m: string) => new DomainError("VALIDATION", m);
export const conflict = (m: string) => new DomainError("TRANSITION_CONFLICT", m);
export const alreadySubmitted = (m = "already_submitted") => new DomainError("ALREADY_SUBMITTED", m);

export function isErrorCode(x: unknown): x is ErrorCode {
  return typeof x === "string" && x in ERROR_STATUS;
}

/** Response body: { error, code } (api/ROUTES.md) */
export function errorBody(code: ErrorCode, message: string): { error: string; code: string } {
  return { error: message, code };
}
