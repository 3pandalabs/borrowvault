import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { generateRefreshSecret, parseRefreshToken, REFRESH_TOKEN_TTL_MS, signAccessToken } from "../auth/jwt.js";
import { hashSecret, verifySecret } from "../auth/password.js";
import { db } from "../db/index.js";
import { passwordResetTokens, sessions, users } from "../db/schema.js";
import { env } from "../env.js";
import { sendMail, simpleMail } from "../lib/mailer.js";
import { userView } from "../lib/users.js";
import { keyedLimiter } from "../lib/clientKey.js";
import { globalLimiter, registerRateLimit } from "../plugins/rateLimit.js";

// Auth, same scheme as RsvpVault: 15-min JWT access token + rotating opaque
// refresh token (`<sessionId>.<secret>`, bcrypt-hashed at rest).

const email = z.string().email().max(320);
const password = z.string().min(10).max(200);
export const phoneSchema = z.string().regex(/^\+?[0-9]{10,15}$/, "phone must be 10-15 digits, optional leading +");

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINUTE = 60_000;

// Bound the mail a single unauthenticated route can trigger, across all callers.
const resetMailBudget = globalLimiter(200, 60 * MINUTE);
// Login: per-IP (route config) + per-email + a global ceiling, so credential
// stuffing can't just rotate IPs against one account or spray the whole table.
const loginPerEmail = keyedLimiter(10, 15 * MINUTE);
const loginGlobal = globalLimiter(2000, 15 * MINUTE);
const DUMMY_HASH = "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu";

async function issueSession(userId: string) {
  const secret = generateRefreshSecret();
  const [session] = await db
    .insert(sessions)
    .values({ userId, refreshTokenHash: await hashSecret(secret), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) })
    .returning({ id: sessions.id });
  return `${session.id}.${secret}`;
}

async function tokens(user: typeof users.$inferSelect) {
  return {
    accessToken: signAccessToken({ sub: user.id }),
    refreshToken: await issueSession(user.id),
    user: userView(user),
  };
}

export async function authRoutes(fastify: FastifyInstance) {
  await registerRateLimit(fastify);
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/auth/signup",
    {
      config: { rateLimit: { max: 10, timeWindow: 60 * MINUTE } },
      schema: {
        body: z.object({
          email,
          password,
          displayName: z.string().trim().min(1).max(120),
          phone: phoneSchema,
        }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const [user] = await db
        .insert(users)
        .values({
          email: b.email.toLowerCase(),
          passwordHash: await hashSecret(b.password),
          displayName: b.displayName,
          phone: b.phone,
        })
        .onConflictDoNothing({ target: users.email })
        .returning();
      // Generic failure for a taken address: no account-enumeration oracle.
      if (!user) return reply.code(409).send({ error: "registration_failed", code: "CONFLICT" });
      return reply.code(201).send(await tokens(user));
    },
  );

  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 20, timeWindow: 15 * MINUTE } }, schema: { body: z.object({ email, password: z.string().min(1).max(200) }) } },
    async (req, reply) => {
      const emailKey = req.body.email.toLowerCase();
      if (!loginGlobal() || !loginPerEmail(emailKey)) return reply.code(429).send({ error: "rate_limited" });
      const [user] = await db.select().from(users).where(eq(users.email, emailKey)).limit(1);
      if (!user) {
        // Equalise timing between "no such account" and "wrong password".
        await verifySecret(req.body.password, DUMMY_HASH);
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      if (!(await verifySecret(req.body.password, user.passwordHash))) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      return tokens(user);
    },
  );

  app.post(
    "/auth/refresh",
    { config: { rateLimit: { max: 60, timeWindow: 15 * MINUTE } }, schema: { body: z.object({ refreshToken: z.string().min(1).max(500) }) } },
    async (req, reply) => {
      const parsed = parseRefreshToken(req.body.refreshToken);
      if (!parsed) return reply.code(401).send({ error: "invalid_refresh_token" });
      const [session] = await db.select().from(sessions).where(eq(sessions.id, parsed.sessionId)).limit(1);
      if (!session || session.expiresAt.getTime() < Date.now() || !(await verifySecret(parsed.secret, session.refreshTokenHash))) {
        return reply.code(401).send({ error: "invalid_refresh_token" });
      }
      const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
      if (!user) return reply.code(401).send({ error: "invalid_refresh_token" });
      // Rotate: a stolen refresh token works at most once.
      const deleted = await db.delete(sessions).where(eq(sessions.id, session.id)).returning({ id: sessions.id });
      if (!deleted.length) return reply.code(401).send({ error: "invalid_refresh_token" });
      return tokens(user);
    },
  );

  app.post(
    "/auth/logout",
    { preHandler: requireAuth, schema: { body: z.object({ refreshToken: z.string().min(1).max(500) }) } },
    async (req, reply) => {
      // Only a token that verifies AND belongs to the caller can end a session;
      // otherwise anyone holding a session id could log someone else out.
      const parsed = parseRefreshToken(req.body.refreshToken);
      if (parsed) {
        const [session] = await db.select().from(sessions).where(eq(sessions.id, parsed.sessionId)).limit(1);
        if (session && session.userId === req.userId && (await verifySecret(parsed.secret, session.refreshTokenHash))) {
          await db.delete(sessions).where(and(eq(sessions.id, session.id), eq(sessions.userId, req.userId!)));
        }
      }
      return reply.code(204).send();
    },
  );

  // --- password reset (same flow as RsvpVault's forgot/reset) ---------------
  // Both answer identically whether or not the account exists.

  app.post(
    "/auth/password-reset/request",
    { config: { rateLimit: { max: 5, timeWindow: 60 * MINUTE } }, schema: { body: z.object({ email }) } },
    async (req, reply) => {
      const [user] = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.email, req.body.email.toLowerCase()))
        .limit(1);
      // Same work whether or not the account exists (a bcrypt hash either way),
      // and the mail goes out fire-and-forget, so timing can't enumerate accounts.
      const secret = randomBytes(32).toString("base64url");
      const tokenHash = await hashSecret(secret);
      if (user && resetMailBudget()) {
        await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
        const [row] = await db
          .insert(passwordResetTokens)
          .values({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) })
          .returning({ id: passwordResetTokens.id });
        const token = `${row.id}.${secret}`;
        const url = `${env.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
        // Not awaited. Fail-soft: BorrowVault has no verified sender yet.
        void sendMail(
          [
            {
              ...simpleMail(
                user.email,
                "Reset your BorrowVault password",
                `Someone asked to reset the password for this BorrowVault account. The link works once and expires in 30 minutes. If this wasn't you, ignore this email.`,
              ),
              text: `Someone asked to reset the password for this BorrowVault account.

Open this link to choose a new one (works once, expires in 30 minutes):
${url}

If this wasn't you, ignore this email.`,
            },
          ],
          (msg) => req.log.info({ userId: user.id }, msg),
        ).catch((err) => req.log.warn({ err }, "password reset mail failed"));
      }
      return reply.code(204).send();
    },
  );

  app.post(
    "/auth/password-reset/confirm",
    {
      config: { rateLimit: { max: 10, timeWindow: 15 * MINUTE } },
      schema: { body: z.object({ token: z.string().min(1).max(500), password }) },
    },
    async (req, reply) => {
      const [id, secret] = req.body.token.split(".");
      const invalidToken = () => reply.code(400).send({ error: "invalid_or_expired_token" });
      if (!id || !secret || !UUID.test(id)) return invalidToken();
      const [row] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.id, id)).limit(1);
      if (!row || !(await verifySecret(secret, row.tokenHash))) return invalidToken();
      // Atomically consume BEFORE changing the password: two concurrent confirms
      // with the same token can't both win.
      const consumed = await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, sql`now()`)))
        .returning({ userId: passwordResetTokens.userId });
      if (!consumed.length) return invalidToken();
      await db.update(users).set({ passwordHash: await hashSecret(req.body.password) }).where(eq(users.id, consumed[0].userId));
      await db.delete(sessions).where(eq(sessions.userId, consumed[0].userId));
      return reply.code(204).send();
    },
  );
}
