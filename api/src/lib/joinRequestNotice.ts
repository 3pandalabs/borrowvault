// The join request notice (api/ROUTES.md "Join request notice"): the email
// and push every approved admin of the society gets when a resident asks to
// join. No db access, so it's unit-tested. Only the requester's name and
// tower/flat go out: never their email, phone, occupancy or proof.

import { actionMail, type Mail } from "./mailer.js";
import type { PushMessage } from "./push.js";

export type JoinRequestNotice = {
  membershipId: string;
  societyId: string;
  societyName: string;
  requesterName: string;
  towerName: string | null;
  flatNo: string | null;
  /** Absolute URL of the society's web admin console. */
  url: string;
};

const who = (n: JoinRequestNotice) => n.requesterName.trim() || "A resident";

/** "A-101", or just one part when the other is missing. */
export function joinRequestFlat(n: Pick<JoinRequestNotice, "towerName" | "flatNo">): string {
  return [n.towerName, n.flatNo].filter((x) => x && x.trim()).join("-");
}

export function joinRequestSubject(n: JoinRequestNotice): string {
  return `${who(n)} asked to join ${n.societyName}`;
}

export function joinRequestMail(to: string, n: JoinRequestNotice): Mail {
  const parts = [n.towerName ? `tower ${n.towerName}` : null, n.flatNo ? `flat ${n.flatNo}` : null].filter(Boolean);
  const where = parts.length ? ` (${parts.join(", ")})` : "";
  const text =
    `${who(n)}${where} asked to join ${n.societyName} on BorrowVault. ` +
    "Check their proof of residence against the flat, then approve or decline the request in your society admin console.";
  const footer = `You're getting this because you're a society admin of ${n.societyName}.`;
  return actionMail(to, joinRequestSubject(n), text, "Review join request", n.url, footer);
}

export function joinRequestPushMessages(tokens: string[], n: JoinRequestNotice): PushMessage[] {
  const flat = joinRequestFlat(n);
  return tokens.map((to) => ({
    to,
    title: "New join request",
    body: `${who(n)}${flat ? ` (${flat})` : ""} asked to join ${n.societyName}. Tap to review.`,
    data: { type: "join_request", societyId: n.societyId, membershipId: n.membershipId },
    sound: "default",
    channelId: "default",
  }));
}
