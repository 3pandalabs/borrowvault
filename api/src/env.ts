import "dotenv/config";
import { z } from "zod";

// Validated once at import. Every process that touches the database (API,
// Temporal worker, seed) loads this; pure modules (lib/upi, lib/geo,
// booking/nextAction, booking/states) deliberately do not, so unit tests run
// without any environment.
const optional = z.string().optional().default("");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8080),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars (openssl rand -hex 32)"),

  // The web origin. Used for CORS and for absolute links in emails (password
  // reset). CORS_ORIGINS adds extra comma-separated origins (local dev, previews).
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  CORS_ORIGINS: optional,

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1).default("borrowvault-evidence"),
  R2_ENDPOINT: z.string().url(),

  // Optional: unset → GET /metrics answers 503 and nothing else changes.
  METRICS_TOKEN: optional,

  // Shared org mail gateway. Optional: unset (or a gateway that refuses
  // BorrowVault, which has no verified sender yet) → sends are logged and skipped.
  MAILER_URL: optional,
  MAILER_TOKEN: optional,
  EMAIL_FROM_NAME: z.string().default("BorrowVault"),

  // Shared with the web Worker (sent as X-Internal-Secret on api-internal calls).
  // Only with it is X-Client-IP trusted for rate-limit keys. Optional.
  INTERNAL_SHARED_SECRET: optional,

  GIT_COMMIT: optional,
  SOURCE_COMMIT: optional,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Invalid environment: ${issues}`);
}

const e = parsed.data;

export const env = {
  ...e,
  CORS_ORIGINS: [e.WEB_ORIGIN, ...e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)],
  // Coolify injects SOURCE_COMMIT at runtime; GIT_COMMIT is a manual override.
  GIT_COMMIT: e.SOURCE_COMMIT || e.GIT_COMMIT || "unknown",
};
