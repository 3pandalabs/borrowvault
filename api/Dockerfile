# borrowvault-api. Multi-stage: compile TypeScript, run on a slim image.
# node:22-alpine per the org checklist. @temporalio/client is pure JS (grpc-js),
# so alpine is fine here; the WORKER needs glibc (see Dockerfile.worker).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle

RUN addgroup -S borrowvault && adduser -S borrowvault -G borrowvault
USER borrowvault

EXPOSE 8080

# Migrate-on-start. Every file in drizzle/ must be idempotent (IF NOT EXISTS,
# DO $$ ... guards): a migration that fails on re-run crash-loops the API.
# Runs as the runtime role (DATABASE_URL); never set MIGRATION_DATABASE_URL.
# The seed is NOT here: it creates accounts. Run `node dist/db/seed.js` by hand.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
