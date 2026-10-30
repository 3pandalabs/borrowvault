# BorrowVault — repo conventions

Peer-to-peer item rental and micro-gigs **inside one verified gated society**. Fifth backend product at 3PandaLabs (after ReceiptCash, RentVault, RsvpVault and AdVault). Full design: `infra/blueprint.md`. API contract: `api/ROUTES.md`; change the contract first, then the code.

## Naming

**BorrowVault** everywhere. The product was named before anything was provisioned, so there is no copy/identifier split. Every identifier is lowercase `borrowvault`: repo, database, `borrowvault_app` role, R2 buckets (`borrowvault-evidence`, `borrowvault-backups`), Coolify resources (`borrowvault-api`, `borrowvault-worker`), Temporal task queue `borrowvault`, and the `/metrics` app key.

Hostnames, **all under one first label** (Cloudflare's per-app cert depends on it; see the knowledge_base CERTIFICATES gotcha):
`borrowvault.3pandalabs.com` (web) · `api.borrowvault.3pandalabs.com` (proxied) · `api-internal.borrowvault.3pandalabs.com` (DNS-only, for Worker → API).

## Layout

`api/` (Fastify 5 + Drizzle + Zod + JWT + Temporal worker) · `web/` (Next.js 16 on Cloudflare Workers: society-admin console + resident browsing) · `app/` (Expo: residents; **camera-only** inspection capture) · `infra/` (runbooks + blueprint).

## Phase 1 rules (no payment gateway)

- Payments are **UPI only**, through intent links straight to the lender's VPA. The platform never holds money. The lender confirms receipt.
- Deposit mode is a per-society setting. `declared`: no money moves, and an award becomes a recorded debt. `p2p`: the deposit is paid to the lender and refunded via UPI, with confirmations tracked.
- Phase 2 (UPI one-time-mandate block via Razorpay) needs an Indian entity. Keep `DepositProvider` as the seam and don't put gateway code in Phase 1.

## Invariants (don't weaken these)

- `booking.state` changes **only** through `transition()` (conditional update + `booking_events` row in one transaction).
- Double booking is prevented by the `bookings_no_overlap` EXCLUDE constraint, not by app code alone.
- Evidence is write-once: no route overwrites or deletes inspection media, and the server re-hashes every upload.
- Inspections come from each party's own account. One party can never submit for the other.
- A dispute arbiter can't be a party or live in a party's unit.
- 404 (not 403) for anything outside the caller's approved societies.

## Conventions copied from the org checklist (knowledge_base/launching-a-new-app.md)

- Migrations are idempotent and run at container start. Don't set `MIGRATION_DATABASE_URL`.
- R2 `S3Client` uses `requestChecksumCalculation: "WHEN_REQUIRED"`. Commit the `infra/r2-cors.json` CORS policy for the evidence bucket.
- `GET /metrics` uses the shared envelope, and `METRICS_TOKEN` is optional (503 when unset).
- `web/.env.production` is committed with the `NEXT_PUBLIC_*` values. Use `next build --webpack`. No `proxy.ts`/middleware.
- `robots.ts` + `sitemap.ts`; `noindex` on authed routes.
- Dockerfiles use `node:22-alpine`.

## Git flow

Never commit directly to `main`: branch → PR → merge, committing as `3pandalabs-admin` (the conditional gitconfig keys on the `3pandalabs` remote URL, so add the remote before the first commit). Stage files explicitly and never run `git add -A`.
