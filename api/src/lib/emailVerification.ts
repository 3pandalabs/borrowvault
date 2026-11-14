import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, TransactionRollbackError } from "drizzle-orm";
import { db } from "../db/index.js";
import { emailVerificationTokens, users } from "../db/schema.js";
import { env } from "../env.js";
import { forbidden } from "./errors.js";
import { actionMail, sendMail } from "./mailer.js";

// Email verification (api/ROUTES.md "Email verification"). A typo'd signup
// address would otherwise swallow every password reset and notice.

export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const hashVerifyToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Replaces the user's unused links with a fresh one and emails it in the
 * background (fail-soft: never throws because of the mail).
 */
export async function sendVerificationEmail(user: { id: string; email: string }, log: (msg: string) => void): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await db.delete(emailVerificationTokens).where(and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt)));
  await db.insert(emailVerificationTokens).values({
    userId: user.id,
    email: user.email,
    tokenHash: hashVerifyToken(token),
    expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
  });
  const url = `${env.WEB_ORIGIN}/verify-email?token=${encodeURIComponent(token)}`;
  void sendMail(
    [
      actionMail(
        user.email,
        "Confirm your BorrowVault email",
        "Welcome to BorrowVault. Confirm this is your email address so password resets and booking notices reach you. The link works once and expires in 24 hours.",
        "Confirm my email",
        url,
        "If you didn't sign up for BorrowVault, ignore this email.",
      ),
    ],
    log,
  ).catch((err) => log(`verification mail failed: ${String(err)}`));
}

export type VerifyResult = "verified" | "already" | "invalid";

/** Consumes a link. A used link presented again is a no-op success. */
export async function verifyEmailToken(token: string): Promise<VerifyResult> {
  const [row] = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, hashVerifyToken(token)))
    .limit(1);
  if (!row) return "invalid";
  if (row.usedAt) return "already";
  if (row.expiresAt.getTime() <= Date.now()) return "invalid";
  return db.transaction(async (tx) => {
    const consumed = await tx
      .update(emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(emailVerificationTokens.id, row.id), isNull(emailVerificationTokens.usedAt)))
      .returning({ id: emailVerificationTokens.id });
    if (!consumed.length) return "already" as const; // a concurrent click won
    // Bound to the address it was sent to: no-op if the account's email changed.
    const updated = await tx
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(and(eq(users.id, row.userId), eq(users.email, row.email), isNull(users.deletedAt)))
      .returning({ id: users.id });
    if (!updated.length) {
      tx.rollback();
    }
    return "verified" as const;
  }).catch((err: unknown) => {
    if (err instanceof TransactionRollbackError) return "invalid" as const;
    throw err;
  });
}

/** 403 email_unverified unless the user has confirmed their address. */
export async function assertEmailVerified(userId: string): Promise<void> {
  const [u] = await db.select({ verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.verifiedAt) throw forbidden("email_unverified");
}
