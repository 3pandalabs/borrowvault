import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { memberships, users } from "../db/schema.js";
import { sendMail, simpleMail } from "./mailer.js";

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
    const rows = await db.select({ email: users.email }).from(users).where(inArray(users.id, ids));
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
