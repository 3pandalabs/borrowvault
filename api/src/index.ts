import cors from "@fastify/cors";
import Fastify, { type FastifyError } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { authPlugin } from "./auth/plugin.js";
import { env } from "./env.js";
import { DomainError } from "./lib/errors.js";
import { recordRequest, startCpuSampler } from "./metrics/collector.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { bookingRoutes } from "./routes/bookings.js";
import { listingRoutes } from "./routes/listings.js";
import { metricsRoutes } from "./routes/metrics.js";
import { societyRoutes } from "./routes/societies.js";

const app = Fastify({
  logger: true,
  // Traefik (and Cloudflare) sit in front; without this req.ip is the proxy
  // and rate limiting would bucket every caller together.
  trustProxy: true,
}).withTypeProvider<ZodTypeProvider>();

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });
await app.register(authPlugin);

const startedAt = new Date().toISOString();
// `ok` is what the container health check reads; its shape must not change.
app.get("/health", async () => ({ ok: true, commit: env.GIT_COMMIT, startedAt }));

startCpuSampler();
app.addHook("onResponse", async (req) => {
  if (req.url !== "/metrics" && req.url !== "/health") recordRequest();
});

app.setErrorHandler((err: FastifyError & { code?: string; publicCode?: string }, req, reply) => {
  if (err instanceof DomainError) {
    return reply.code(err.status).send({ error: err.message, code: err.code });
  }
  if (err.validation) {
    return reply.code(400).send({ error: err.message || "invalid_request", code: "VALIDATION" });
  }
  // Rate limiting (plugins/rateLimit.ts) carries a caller-facing code.
  if (err.publicCode) {
    return reply.code(err.statusCode ?? 429).send({ error: err.publicCode });
  }
  if (err.code === "23505") return reply.code(409).send({ error: "conflict", code: "CONFLICT" });
  if (err.code === "23P01") return reply.code(409).send({ error: "the item is already booked for that time", code: "OVERLAP" });
  if (err.code === "23514") return reply.code(400).send({ error: "invalid_request", code: "VALIDATION" });
  const status = err.statusCode ?? 500;
  if (status < 500) return reply.code(status).send({ error: err.code ?? "bad_request" });
  req.log.error(err);
  return reply.code(status).send({ error: "internal_error" });
});

await app.register(authRoutes);
await app.register(societyRoutes);
await app.register(adminRoutes);
await app.register(listingRoutes);
await app.register(bookingRoutes);
await app.register(metricsRoutes);

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
