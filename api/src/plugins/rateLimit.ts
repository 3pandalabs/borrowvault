import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "../env.js";
import { selectClientKey } from "../lib/clientKey.js";

// Rate limiting for the auth routes (adapted from RentVault). Two layers:
//
// LAYER 1, per caller. Keyed by lib/clientKey.ts: X-Client-IP is trusted ONLY
// with a matching X-Internal-Secret (INTERNAL_SHARED_SECRET, sent by the web
// Worker over api-internal, where there is no CF-Connecting-IP). Otherwise
// CF-Connecting-IP, then req.ip. Login is additionally limited per email.
//
// LAYER 2, a global ceiling per route across every caller, which bounds the
// damage however many identities an attacker invents.
//
// Both are in-process: borrowvault-api is one container. Scaled out, they
// become per-replica and want a shared store.

type RateLimitError = Error & { statusCode: number; publicCode: string };

export function clientKey(req: FastifyRequest): string {
  return selectClientKey(req, env.INTERNAL_SHARED_SECRET);
}

// A fixed window rather than a rolling one: one number, no per-key bookkeeping,
// and nothing that grows with the number of distinct callers. The edge case a
// fixed window brings — up to 2x the budget across a window boundary — does not
// matter at these volumes.
export function globalLimiter(max: number, windowMs: number) {
  let windowStart = Date.now();
  let count = 0;

  return function allow(): boolean {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    if (count >= max) return false;
    count += 1;
    return true;
  };
}

// Register inside a route plugin's own encapsulated scope so the limiter
// applies only to that plugin's routes. `global: false` keeps it off every
// route that does not explicitly opt in via `config.rateLimit`.
export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: false,
    keyGenerator: clientKey,
    // The plugin *throws* whatever this returns, and Fastify reads statusCode
    // off the thrown value — so returning a bare `{ error: "rate_limited" }`
    // object yields a 500, not a 429. It has to be an Error carrying the
    // status. `publicCode` is what index.ts's error handler renders as the
    // response body, keeping the app-wide `{ "error": "<code>" }` shape.
    errorResponseBuilder: (_req, context) => {
      const err = new Error(`rate limit exceeded, retry in ${context.after}`) as RateLimitError;
      err.statusCode = context.statusCode;
      err.publicCode = "rate_limited";
      return err;
    },
  });
}
