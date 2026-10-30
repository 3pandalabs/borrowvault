# ShareVault — infra runbook

This follows `knowledge_base/launching-a-new-app.md` (read it first) and mirrors RsvpVault's `infra/`, so only the ShareVault-specific values are listed here.

## Identifiers

| Thing | Value |
|---|---|
| Repo | `3pandalabs/sharevault` (**public**, because Coolify's public-repo source has no credentials) |
| Database / role | `sharevault` / `sharevault_app` on the shared `3pandalabs-postgres` |
| R2 buckets | `sharevault-evidence` (inspection photos/videos, membership proofs, listing photos) · `sharevault-backups` |
| Coolify apps | `sharevault-api` (base dir `api`, `Dockerfile`, port 8080) · `sharevault-worker` (base dir `api`, `Dockerfile.worker`) |
| Temporal | namespace `default`, task queue `sharevault` (shared Temporal on the box) |
| Web Worker | `sharevault-web` → `sharevault.3pandalabs.com` (wrangler owns that DNS record) |
| API hosts | `api.sharevault.3pandalabs.com` (orange) · `api-internal.sharevault.3pandalabs.com` (grey) → `167.233.223.241` |
| Metrics key | `sharevault` |

## Provisioning order

1. Repo public, scaffold PR merged so that `main` contains `api/`.
2. R2: create both buckets and an API token scoped to **just those two**, then `wrangler r2 bucket cors set sharevault-evidence --file infra/r2-cors.json`.
3. Postgres, run against the container that actually holds the app DBs (`psql -U postgres -c '\l'` first; there are two postgres containers):
   ```sql
   CREATE ROLE sharevault_app LOGIN PASSWORD '<generate>';
   CREATE DATABASE sharevault OWNER sharevault_app;
   \c sharevault
   ALTER SCHEMA public OWNER TO sharevault_app;
   CREATE EXTENSION IF NOT EXISTS btree_gist;   -- superuser; needed by bookings_no_overlap
   ```
   Record the password in Claude memory.
4. DNS for both API hosts **before** the first Coolify deploy. Expect edge TLS on `api.sharevault` to take minutes to hours, and don't debug the origin while you wait.
5. Coolify: create both apps, add env vars from `api/.env.example`, use `https://` in the domains, and set up the backup schedule to `sharevault-backups`.
6. Seed: `npm run seed` once, from the container shell.
7. Web: `cd web && npm run cf:deploy`.
8. Mobile: `eas init` (creates the project under the `3pandalabs` account), then a `preview` build.
9. Update the six surfaces (website card, admin page + METRICS_TARGETS + flow diagram, tech-stack.md section, memory, Uptime Kuma, Search Console).

## Known constraints

- **Email:** Resend holds one verified domain (`rsvpvault`), and adding another evicts it. ShareVault sends fail soft until a sender is sorted out. Push notifications carry the time-critical steps.
- **Payments:** Phase 1 has no gateway. Phase 2 (UPI mandate blocks via Razorpay) needs an Indian entity.
