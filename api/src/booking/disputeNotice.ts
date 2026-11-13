// Dispute notices (api/ROUTES.md "Dispute notices"): push + email to one
// party after a dispute response or an accepted offer.
//
// FIRE-AND-FORGET like lib/notify.ts: the exports start the work in the
// background and return at once, and every failure is logged and swallowed,
// so a route never fails and a Temporal activity never retries because of a
// notice.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { listings, users } from "../db/schema.js";
import { env } from "../env.js";
import { sendMail } from "../lib/mailer.js";
import { sendPush } from "../lib/push.js";
import { bookingPushTargets } from "../lib/pushTokens.js";
import { offerAcceptedNotice, responseNotice, type Notice } from "./disputeNoticeText.js";

const log = (msg: string) => console.log(`[dispute-notice] ${msg}`);

type BookingRef = { id: string; listingId: string };

const bookingUrl = (bookingId: string) => `${env.WEB_ORIGIN.replace(/\/$/, "")}/bookings/${bookingId}`;

async function deliver(recipientId: string, bookingId: string, n: Notice): Promise<void> {
  const [u] = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.id, recipientId), isNull(users.deletedAt)))
    .limit(1);
  if (!u) return; // deleted account: tombstone address, no devices
  const tokens = await bookingPushTargets(recipientId).catch((err: unknown) => {
    log(`push targets failed: ${String(err)}`);
    return [] as string[];
  });
  await Promise.all([
    tokens.length
      ? sendPush(
          tokens.map((to) => ({
            to,
            title: n.push.title,
            body: n.push.body,
            data: { type: "booking", bookingId },
            sound: "default" as const,
            priority: "high" as const,
            channelId: "default",
          })),
        )
      : Promise.resolve(),
    sendMail([{ to: u.email, ...n.mail }], log),
  ]);
}

async function displayName(userId: string): Promise<string> {
  const [u] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.displayName ?? "";
}

async function itemTitle(listingId: string): Promise<string> {
  const [l] = await db.select({ title: listings.title }).from(listings).where(eq(listings.id, listingId)).limit(1);
  return l?.title ?? "";
}

/** To the raiser: the other party responded, with or without a settlement offer. */
export function noticeDisputeResponse(i: {
  booking: BookingRef;
  raiserId: string;
  responderId: string;
  claimedPaise: number;
  offerPaise: number | null;
  responseText: string;
  pilot: boolean;
  escalatesAt: Date | null;
}): void {
  void (async () => {
    try {
      const [who, item] = await Promise.all([displayName(i.responderId), itemTitle(i.booking.listingId)]);
      const n = responseNotice({
        responderName: who,
        itemTitle: item,
        claimedPaise: i.claimedPaise,
        offerPaise: i.offerPaise,
        responseText: i.responseText,
        pilot: i.pilot,
        escalatesAt: i.escalatesAt,
        url: bookingUrl(i.booking.id),
      });
      await deliver(i.raiserId, i.booking.id, n);
    } catch (err) {
      log(`response notice failed: ${String(err)}`);
    }
  })();
}

/** To the responder: the raiser accepted their offer. */
export function noticeOfferAccepted(i: { booking: BookingRef; raiserId: string; responderId: string; offerPaise: number }): void {
  void (async () => {
    try {
      const [who, item] = await Promise.all([displayName(i.raiserId), itemTitle(i.booking.listingId)]);
      const n = offerAcceptedNotice({
        raiserName: who,
        itemTitle: item,
        offerPaise: i.offerPaise,
        url: bookingUrl(i.booking.id),
      });
      await deliver(i.responderId, i.booking.id, n);
    } catch (err) {
      log(`offer-accepted notice failed: ${String(err)}`);
    }
  })();
}
