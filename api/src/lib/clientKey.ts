import { timingSafeEqual } from "node:crypto";

// Which address a rate-limit bucket is keyed on. Pure (no env), so it's unit-tested.
//
//  1. X-Client-IP, ONLY when the request also carries X-Internal-Secret equal to
//     INTERNAL_SHARED_SECRET. That's the web Worker calling api-internal (DNS-only,
//     so there's no CF-Connecting-IP) and forwarding the visitor's address.
//     Without the secret, X-Client-IP is attacker-controlled and ignored.
//  2. CF-Connecting-IP: set by Cloudflare on proxied traffic; a client can't forge it.
//  3. req.ip (behind trustProxy).

type Headers = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export function secretMatches(presented: string | undefined, expected: string): boolean {
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function selectClientKey(req: { headers: Headers; ip: string }, internalSecret: string): string {
  if (secretMatches(first(req.headers["x-internal-secret"]), internalSecret)) {
    const forwarded = first(req.headers["x-client-ip"]);
    if (forwarded) return forwarded;
  }
  return first(req.headers["cf-connecting-ip"]) ?? req.ip;
}

/**
 * Fixed-window limiter keyed by an arbitrary string (e.g. a login email).
 * In-process; entries are pruned when their window has passed.
 */
export function keyedLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const buckets = new Map<string, { start: number; count: number }>();
  return function allow(key: string): boolean {
    const t = now();
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (t - v.start >= windowMs) buckets.delete(k);
    }
    const b = buckets.get(key);
    if (!b || t - b.start >= windowMs) {
      buckets.set(key, { start: t, count: 1 });
      return true;
    }
    if (b.count >= max) return false;
    b.count += 1;
    return true;
  };
}
