# BorrowVault — infra runbook

This follows `knowledge_base/launching-a-new-app.md` (read it first) and mirrors RsvpVault's `infra/`, so only the BorrowVault-specific values are listed here.

## Identifiers

| Thing | Value |
|---|---|
| Repo | `3pandalabs/borrowvault` (**public**, because Coolify's public-repo source has no credentials) |
| Database / role | `borrowvault` / `borrowvault_app` on the shared `3pandalabs-postgres` |
| R2 buckets | `borrowvault-evidence` (inspection photos/videos, membership proofs, listing photos) · `borrowvault-backups` |
| Coolify apps | `borrowvault-api` (base dir `api`, `Dockerfile`, port 8080) · `borrowvault-worker` (base dir `api`, `Dockerfile.worker`) |
| Temporal | namespace `default`, task queue `borrowvault` (shared Temporal on the box) |
| Web Worker | `borrowvault-web` → `borrowvault.3pandalabs.com` (wrangler owns that DNS record) |
| API hosts | `api.borrowvault.3pandalabs.com` (orange) · `api-internal.borrowvault.3pandalabs.com` (grey) → `167.233.223.241` |
| Metrics key | `borrowvault` |

## Provisioning order

1. Repo public, scaffold PR merged so that `main` contains `api/`.
2. R2: create both buckets and an API token scoped to **just those two**, then `wrangler r2 bucket cors set borrowvault-evidence --file infra/r2-cors.json`.
3. Postgres, run against the container that actually holds the app DBs (`psql -U postgres -c '\l'` first; there are two postgres containers):
   ```sql
   CREATE ROLE borrowvault_app LOGIN PASSWORD '<generate>';
   CREATE DATABASE borrowvault OWNER borrowvault_app;
   \c borrowvault
   ALTER SCHEMA public OWNER TO borrowvault_app;
   CREATE EXTENSION IF NOT EXISTS btree_gist;   -- superuser; needed by bookings_no_overlap
   ```
   Record the password in Claude memory.
4. DNS for both API hosts **before** the first Coolify deploy. Expect edge TLS on `api.borrowvault` to take minutes to hours, and don't debug the origin while you wait.
5. Coolify: create both apps, add env vars from `api/.env.example`, use `https://` in the domains, and set up the backup schedule to `borrowvault-backups`.
6. Seed: `npm run seed` once, from the container shell.
7. Web: `cd web && npm run cf:deploy`.
8. Mobile: `eas init` (creates the project under the `3pandalabs` account), then a `preview` build.
9. Update the six surfaces (website card, admin page + METRICS_TARGETS + flow diagram, tech-stack.md section, memory, Uptime Kuma, Search Console).

## Known constraints

- **Email:** Resend holds one verified domain (`rsvpvault`), and adding another evicts it. BorrowVault sends fail soft until a sender is sorted out. Push notifications carry the time-critical steps.
- **Payments:** Phase 1 has no gateway. Phase 2 (UPI mandate blocks via Razorpay) needs an Indian entity.

## Backups

Coolify's scheduled backup on the shared Postgres resource (`fj1trumhdfozqharrsx1frm9`), created via the Coolify API on 2026-11-10:

- Backup config `wq1zli6egmqx6wjebrprl8m2`: database `borrowvault` only, cron `30 21 * * *` (21:30 UTC = 03:00 IST), keeps 3 copies on the server and 30 in R2 (30 days max).
- Destination: Coolify S3 storage `l6u9d1dewzke4vurzmtzgagy`, bucket `borrowvault-backups`, region `auto`, path-style, using the same scoped R2 key pair as the API.
- Format: `pg_dump -Fc` (`.dmp`), at `data/coolify/backups/databases/root-team-0/postgresql-database-<uuid>-<uuid>/pg-dump-borrowvault-<epoch>-<id>.dmp` inside the bucket.

**Restore drill (passed 2026-11-10):** download the newest `.dmp` from R2 (aws-cli with `--endpoint-url` set to the R2 endpoint), restore it into a throwaway `postgres:17-alpine` with `createdb borrowvault && pg_restore -d borrowvault --no-owner --no-acl`, and compare row counts with prod. All 26 tables restored. For a real restore into prod, create `btree_gist` as superuser first, restore as `borrowvault_app`, and stop `borrowvault-api` + `borrowvault-worker` while it runs.

## Mobile: OTA updates and crash reports

- **expo-updates**: `runtimeVersion` follows `version` in `app.json` (policy `appVersion`). Each EAS build profile has a channel of the same name. Ship JS-only fixes with `eas update --channel preview` (or `production`). Phones fetch the update on launch and run it on the next launch. Bump `version` whenever native code or config changes (new native module, permissions, plugins), because an update can only reach builds with the same runtime version.
- **Sentry**: on only when `EXPO_PUBLIC_SENTRY_DSN` is set at build time (EAS env var, visibility "plain text", since the DSN ships in the app anyway). There's no source-map upload yet, so stack traces are minified.
