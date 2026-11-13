import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { memberships, users } from "../db/schema.js";
import { env } from "../env.js";
import { sendMail, simpleMail } from "./mailer.js";
import { nominationMail, nominationPushMessages } from "./nominationNotice.js";
import { sendPush } from "./push.js";
import { bookingPushTargets } from "./pushTokens.js";

// FIRE-AND-FORGET: every export starts the send in the background and returns
// immediately, so an action (or a Temporal update) never waits on, or fails
// because of, mail. E.g. raiseDispute can't 503 after it has committed.
//
// Phase 1 notifications are email through the shared gateway. BorrowVault has
// no verified sender yet, so these are best-effort: every failure is logged
// and swallowed. A notification must never fail a booking action or make a
// Temporal activity retry (which would repeat its state change attempt).

const log = (msg: string) => console.log(`[notify] ${msg}`);

async function send(emails: string[], subject: string, text: string, link?: string): Promise<void> {
  try {
    await sendMail(
      emails.map((to) => simpleMail(to, subject, text, link)),
      log,
    );
  } catch (err) {
    log(`send failed: ${String(err)}`);
  }
}

export async function notifyUsers(userIds: string[], subject: string, text: string, link?: string): Promise<void> {
  void notifyUsersNow(userIds, subject, text, link);
}

async function notifyUsersNow(userIds: string[], subject: string, text: string, link?: string): Promise<void> {
  try {
    const ids = [...new Set(userIds)];
    if (!ids.length) return;
    // Deleted accounts have a tombstone address; never mail it.
    const rows = await db.select({ email: users.email }).from(users).where(and(inArray(users.id, ids), isNull(users.deletedAt)));
    await send(rows.map((r) => r.email), subject, text, link);
  } catch (err) {
    log(`notifyUsers failed: ${String(err)}`);
  }
}

export async function notifySocietyAdmins(societyId: string, subject: string, text: string, link?: string): Promise<void> {
  void notifySocietyAdminsNow(societyId, subject, text, link);
}

async function notifySocietyAdminsNow(societyId: string, subject: string, text: string, link?: string): Promise<void> {
  try {
    const rows = await db
      .select({ email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.societyId, societyId),
          eq(memberships.role, "society_admin"),
          eq(memberships.status, "approved"),
        ),
      );
    await send(rows.map((r) => r.email), subject, text, link);
  } catch (err) {
    log(`notifySocietyAdmins failed: ${String(err)}`);
  }
}

export async function notifyPlatformAdmins(subject: string, text: string, link?: string): Promise<void> {
  void notifyPlatformAdminsNow(subject, text, link);
}

async function notifyPlatformAdminsNow(subject: string, text: string, link?: string): Promise<void> {
  try {
    const rows = await db.select({ email: users.email }).from(users).where(eq(users.isPlatformAdmin, true));
    await send(rows.map((r) => r.email), subject, text, link);
  } catch (err) {
    log(`notifyPlatformAdmins failed: ${String(err)}`);
  }
}

/**
 * A new co-admin nomination (api/ROUTES.md "Co-admin nominations"): the
 * nominee gets a proper email and a push on every registered device.
 */
export async function notifyNominee(
  nomineeId: string,
  n: { requestId: string; nominatorName: string; societyName: string },
): Promise<void> {
  void notifyNomineeNow(nomineeId, n);
}

async function notifyNomineeNow(
  nomineeId: string,
  n: { requestId: string; nominatorName: string; societyName: string },
): Promise<void> {
  const notice = { ...n, url: `${env.WEB_ORIGIN}/admin-requests` };
  try {
    const [row] = await db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.id, nomineeId), isNull(users.deletedAt)));
    if (row) await sendMail([nominationMail(row.email, notice)], log);
  } catch (err) {
    log(`notifyNominee mail failed: ${String(err)}`);
  }
  try {
    const tokens = await bookingPushTargets(nomineeId);
    if (tokens.length) await sendPush(nominationPushMessages(tokens, notice));
  } catch (err) {
    log(`notifyNominee push failed: ${String(err)}`);
  }
}
