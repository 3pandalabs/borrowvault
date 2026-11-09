import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { markUserDeleted, requireAuth } from "../auth/plugin.js";
import { verifySecret } from "../auth/password.js";
import { db } from "../db/index.js";
import { USER_REPORT_REASONS, users } from "../db/schema.js";
import { blockersFor, deleteAccount, purgeObjects } from "../lib/accountDeletion.js";
import * as blocks from "../lib/blocks.js";
import { DomainError, forbidden, invalid, notFound } from "../lib/errors.js";
import * as moderation from "../lib/moderation.js";
import { notifyPlatformAdmins, notifySocietyAdmins } from "../lib/notify.js";
import { clientKey, registerRateLimit } from "../plugins/rateLimit.js";

// Account deletion, blocking and reporting a user (api/ROUTES.md "Account
// deletion", "Users: blocking and reporting").

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const perUser = (req: FastifyRequest) => (req.userId ? `user:${req.userId}` : clientKey(req));

export async function userRoutes(fastify: FastifyInstance) {
  await registerRateLimit(fastify);
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // --- account deletion ----------------------------------------------------

  app.get("/me/deletion", { preHandler: requireAuth }, async (req) => {
    const blockers = await blockersFor(req.userId!);
    return { canDelete: blockers.length === 0, blockers };
  });

  app.post(
    "/me/delete",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 5, timeWindow: 15 * MINUTE, keyGenerator: perUser } },
      schema: { body: z.object({ password: z.string().min(1).max(200) }) },
    },
    async (req, reply) => {
      const me = req.userId!;
      const [u] = await db.select({ passwordHash: users.passwordHash, deletedAt: users.deletedAt }).from(users).where(eq(users.id, me)).limit(1);
      if (!u || u.deletedAt) return reply.code(401).send({ error: "account_deleted" });
      if (!(await verifySecret(req.body.password, u.passwordHash))) throw forbidden("wrong_password");
      const res = await deleteAccount(me);
      if (!res.ok && res.reason === "blocked") {
        return reply.code(409).send({ error: "account_has_open_obligations", code: "CONFLICT", blockers: res.blockers });
      }
      if (!res.ok) return reply.code(401).send({ error: "account_deleted" });
      markUserDeleted(me);
      // After the commit, in the background: the keys are already unreachable.
      void purgeObjects(res.purgedKeys).catch((err) => req.log.warn({ err }, "account deletion: R2 purge failed"));
      req.log.info({ userId: me }, "account deleted");
      return reply.code(204).send();
    },
  );

  // --- blocking --------------------------------------------------------------

  app.post(
    "/users/:id/block",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 30, timeWindow: HOUR, keyGenerator: perUser } },
      schema: { params: idParams },
    },
    async (req, reply) => {
      const me = req.userId!;
      const other = req.params.id;
      if (other === me) throw invalid("cannot_block_self");
      if (!(await blocks.relatedSocieties(me, other)).length) throw notFound();
      const { row, created } = await blocks.block(me, other);
      return reply.code(created ? 201 : 200).send(row);
    },
  );

  app.delete("/users/:id/block", { preHandler: requireAuth, schema: { params: idParams } }, async (req, reply) => {
    await blocks.unblock(req.userId!, req.params.id);
    return reply.code(204).send();
  });

  app.get("/me/blocks", { preHandler: requireAuth }, async (req) => blocks.listBlocks(req.userId!));

  // --- reporting a user ------------------------------------------------------

  app.post(
    "/users/:id/report",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 20, timeWindow: HOUR, keyGenerator: perUser } },
      schema: {
        params: idParams,
        body: z.object({ reason: z.enum(USER_REPORT_REASONS), details: moderation.reportDetails }),
      },
    },
    async (req, reply) => {
      const me = req.userId!;
      const other = req.params.id;
      if (other === me) throw invalid("cannot_report_self");
      const [societyId] = await blocks.relatedSocieties(me, other);
      if (!societyId) throw notFound();
      const r = await moderation.insertUserReport({
        reporterId: me,
        reportedId: other,
        societyId,
        reason: req.body.reason,
        details: req.body.details ?? null,
      });
      if (!r) throw new DomainError("CONFLICT", "already_reported");
      const link = `/admin/${societyId}/reports`;
      void notifySocietyAdmins(societyId, "A resident was reported", "A resident reported another resident. Review it in the society console.", link);
      void notifyPlatformAdmins("A resident was reported", "A resident reported another resident. Review it in the society console.", link);
      return reply.code(201).send({ id: r.id, status: r.status, createdAt: r.createdAt.toISOString() });
    },
  );
}
