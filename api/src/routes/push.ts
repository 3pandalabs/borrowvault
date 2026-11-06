import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { deleteToken, EXPO_PUSH_TOKEN_RE, upsertToken } from "../lib/pushTokens.js";
import { clientKey, registerRateLimit } from "../plugins/rateLimit.js";

// Device push tokens (api/ROUTES.md "Auth / profile": /me/push-tokens).

const HOUR = 3_600_000;
const perUser = (req: FastifyRequest) => (req.userId ? `user:${req.userId}` : clientKey(req));

export async function pushRoutes(fastify: FastifyInstance) {
  await registerRateLimit(fastify);
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/me/push-tokens",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 20, timeWindow: HOUR, keyGenerator: perUser } },
      schema: {
        body: z.object({
          token: z.string().regex(EXPO_PUSH_TOKEN_RE, "invalid Expo push token"),
          platform: z.enum(["ios", "android"]),
        }),
      },
    },
    async (req, reply) => {
      await upsertToken(req.userId!, req.body.token, req.body.platform);
      return reply.code(204).send();
    },
  );

  app.delete(
    "/me/push-tokens",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 30, timeWindow: HOUR, keyGenerator: perUser } },
      schema: { body: z.object({ token: z.string().min(1).max(300) }) },
    },
    async (req, reply) => {
      await deleteToken(req.userId!, req.body.token);
      return reply.code(204).send();
    },
  );
}
