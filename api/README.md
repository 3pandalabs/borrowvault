# BorrowVault API

Fastify 5 + Drizzle (Postgres) + Zod + JWT, with a Temporal worker that owns every booking's timers.
The route contract is [`ROUTES.md`](./ROUTES.md); the full design is [`../infra/blueprint.md`](../infra/blueprint.md).

## Layout

| Path | What |
|---|---|
| `src/index.ts` | HTTP server (routes, CORS, error mapping, `/health`) |
| `src/routes/*` | auth, societies/profile/storage, admin + platform, listings, bookings, metrics |
| `src/booking/states.ts` | state list, `ALLOWED` transition map, timer durations (pure) |
| `src/booking/transition.ts` | **the only writer of `bookings.state`**: row lock, conditional UPDATE and `booking_events` insert, all in the caller's transaction |
| `src/booking/service.ts` | all booking business logic (shared by inline routes and Temporal activities) |
| `src/booking/nextAction.ts` | per-caller `nextAction` + `deadlineAt` (pure) |
| `src/booking/evidence.ts` | presign (Content-Type + Content-Length signed) to an `evidence/` staging key; finalize copies it to an immutable `evidence-final/` key, re-hashes that copy, serves only it, deletes the staging object (an R2 lifecycle rule expiring `evidence/` after 1 day is a good backstop) |
| `src/payments/provider.ts` | `DepositProvider` seam; Phase 1 UPI-link provider (`declared` / `p2p`) |
| `src/temporal/workflows/booking.ts` | `bookingWorkflow`: one per booking, id `booking-<uuid>`, task queue `borrowvault` |
| `src/temporal/activities/booking.ts` | thin wrappers: `DomainError` → non-retryable `ApplicationFailure` |
| `drizzle/` | migrations. `0000_init` is generated and hand-guarded; `0001_bookings_no_overlap` is hand-written (btree_gist + EXCLUDE) |

Plain CRUD runs inline. Every action that can change `booking.state` (accept, decline, cancel, payment confirm, inspections, ack, dispute raise, accept-offer, ruling) runs as a **workflow update**, so the HTTP caller gets the result synchronously. Activity errors map to 409 `TRANSITION_CONFLICT` / `OVERLAP` / `ALREADY_SUBMITTED`, 403, 400 and 404.

## Local development

Prereqs: Node 22+, Docker (for Postgres), and the Temporal CLI (`temporal server start-dev`).

```sh
cp .env.example .env              # fill JWT_SECRET (openssl rand -hex 32), R2_*, SEED_*
docker compose -f docker-compose.dev.yml up -d     # Postgres on :5434
temporal server start-dev         # Temporal on :7233, UI on :8233
npm install
npm run db:migrate                # idempotent; safe to re-run
npm run seed                      # Demo Heights (towers A/B) + platform admin + society admin
npm run dev                       # API on :8080
npm run worker:dev                # Temporal worker (separate terminal)
```

Checks: `npm run typecheck`, `npm test` (pure-unit vitest: no DB/Temporal needed), `npm run build`.

Evidence/listing uploads need a real R2 bucket with CORS (`../infra/r2-cors.json`). Without it, presign still works (it only signs), but finalize can't read the object back.

### Schema changes

Edit `src/db/schema.ts`, run `npm run db:generate`, then **make the new SQL idempotent by hand**: wrap `CREATE TYPE` / `ADD CONSTRAINT` in `DO $$ … EXCEPTION WHEN duplicate_object` and use `ADD COLUMN IF NOT EXISTS`. Migrations run at every container start, so a non-idempotent one crash-loops the API. Keep the `booking_state` enum in `schema.ts` identical to `BOOKING_STATES` in `states.ts` (a unit test checks this). Keep `bookings_no_overlap`'s state list identical to `OCCUPYING_STATES`.

## Deploy (Coolify)

- `borrowvault-api`: `Dockerfile` (node:22-alpine). CMD = `migrate.js && index.js`. The seed is **not** in CMD; run `node dist/db/seed.js` by hand once, with the `SEED_*` vars set.
- `borrowvault-worker`: `Dockerfile.worker` (node:22-bookworm-slim; Temporal's native bridge needs glibc). Same env as the API.
- DB: database `borrowvault`, role `borrowvault_app` owning the schema. **Don't** set `MIGRATION_DATABASE_URL`. `btree_gist` is a trusted extension, so the owner role can create it.

## Environment

| Var | API | Worker | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✓ | ✓ | `borrowvault_app` connection string |
| `JWT_SECRET` | ✓ | ✓ | ≥16 chars; access tokens (15 min). Refresh tokens are opaque rows. |
| `WEB_ORIGIN` | ✓ | ✓ | `https://borrowvault.3pandalabs.com`: CORS + password-reset link base (`/reset-password?token=`) |
| `CORS_ORIGINS` | opt | | extra comma-separated origins |
| `INTERNAL_SHARED_SECRET` | opt | | shared with the web Worker (sent as `X-Internal-Secret` on api-internal); only then is `X-Client-IP` trusted for rate-limit keys |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` | ✓ | ✓ | |
| `R2_BUCKET` | ✓ | ✓ | default `borrowvault-evidence` (evidence/, proofs/, listings/ prefixes) |
| `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE` | ✓ | ✓ | defaults `localhost:7233`, `default`, `borrowvault` |
| `MAILER_URL`, `MAILER_TOKEN`, `EMAIL_FROM_NAME` | opt | opt | shared mail gateway (see below) |
| `METRICS_TOKEN` | opt | | shared org token; unset → `/metrics` answers 503 |
| `PORT` | opt | | default 8080 |
| `SEED_PLATFORM_ADMIN_EMAIL/_PASSWORD`, `SEED_SOCIETY_ADMIN_EMAIL/_PASSWORD` | seed only | | never read by the running API |

### Email: no verified sender yet

Mail goes through the shared `3pandalabs/mailer` gateway (app key `borrowvault`). **BorrowVault has no verified sender**: Resend holds one domain and it's RsvpVault's. Every send (password reset, booking notifications) therefore **fails soft**: it's logged and skipped, and never fails a request or a Temporal activity. Solve the sender before launch (blueprint §8 / open question 6).

## Phase 1 scope notes

- Payments: UPI intent links straight to the counter-party's VPA, with claim → confirm taps. No gateway code; `DepositProvider` is the Phase 2 seam.
- Deposit modes: `declared` (an award becomes a recorded debt) and `p2p` (the deposit is paid to the lender and refunded, with a 24 h auto-dispute timer).
- Platform fee is 0.
- Rate limiting is in-process (`@fastify/rate-limit`) on the auth routes. It becomes per-replica if the API is ever scaled out.
