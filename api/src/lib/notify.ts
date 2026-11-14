import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { memberships, users } from "../db/schema.js";
import { env } from "../env.js";
import { joinRequestMail, joinRequestPushMessages, type JoinRequestNotice } from "./joinRequestNotice.js";
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

/**
 * A resident asked to join a society (api/ROUTES.md "Join request notice"):
 * every approved admin of that society, except the requester, gets an email
 * and a push on every registered device.
 */
export type JoinRequestInput = {
  membershipId: string;
  societyId: string;
  societyName: string;
  requesterId: string;
  towerName: string | null;
  flatNo: string | null;
};

export async function notifyJoinRequest(r: JoinRequestInput): Promise<void> {
  void notifyJoinRequestNow(r);
}

/** Awaitable (tests); never throws. Routes call notifyJoinRequest. */
export async function notifyJoinRequestNow(r: JoinRequestInput): Promise<void> {
  try {
    const [requester] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, r.requesterId));
    const admins = await db
      .select({ id: users.id, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.societyId, r.societyId),
          eq(memberships.role, "society_admin"),
          eq(memberships.status, "approved"),
          ne(memberships.userId, r.requesterId),
          isNull(users.deletedAt),
        ),
      );
    if (!admins.length) return;
    const notice: JoinRequestNotice = {
      membershipId: r.membershipId,
      societyId: r.societyId,
      societyName: r.societyName,
      requesterName: requester?.displayName ?? "",
      towerName: r.towerName,
      flatNo: r.flatNo,
      url: `${env.WEB_ORIGIN}/admin/${r.societyId}`,
    };
    try {
      await sendMail(
        admins.map((a) => joinRequestMail(a.email, notice)),
        log,
      );
    } catch (err) {
      log(`notifyJoinRequest mail failed: ${String(err)}`);
    }
    try {
      const tokens = (await Promise.all(admins.map((a) => bookingPushTargets(a.id)))).flat();
      if (tokens.length) await sendPush(joinRequestPushMessages(tokens, notice));
    } catch (err) {
      log(`notifyJoinRequest push failed: ${String(err)}`);
    }
  } catch (err) {
    log(`notifyJoinRequest failed: ${String(err)}`);
  }
}
