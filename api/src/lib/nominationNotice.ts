// The co-admin nomination notice (api/ROUTES.md "Co-admin nominations"):
// the nominee's email and push. Pure (no env, no db), so it's unit-tested.

import type { Mail } from "./mailer.js";
import type { PushMessage } from "./push.js";

export type NominationNotice = {
  nominatorName: string;
  societyName: string;
  /** Absolute URL of the web admin-requests page. */
  url: string;
};

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const who = (n: NominationNotice) => n.nominatorName.trim() || "An admin of your society";

export function nominationSubject(n: NominationNotice): string {
  return `${who(n)} nominated you as a co-admin of ${n.societyName}`;
}

export function nominationMail(to: string, n: NominationNotice): Mail {
  const nominator = who(n);
  const lines = {
    lead: `${nominator} has nominated you to become a co-admin of ${n.societyName} on BorrowVault.`,
    role: "Co-admins look after the society on BorrowVault: they approve residents who join, issue invite codes and help settle disputes between neighbours.",
    next: "To accept, open your admin requests and upload your own ID proof (a masked Aadhaar showing only the last 4 digits, PAN, passport or driving licence). If you'd rather not, you can decline there too.",
    auto: "Once you accept, you become a co-admin automatically 48 hours later, unless the BorrowVault team rejects it before then.",
    footer: "You're getting this because an admin of your society nominated you. If you don't recognise it, just decline it or ignore this email.",
  };
  const button = "Review nomination";
  const p = 'style="font-size:15px;line-height:1.6;margin:0 0 14px;"';
  const small = 'style="font-size:13px;line-height:1.6;color:#6b7280;margin:0 0 10px;"';
  return {
    to,
    subject: nominationSubject(n),
    text: [lines.lead, lines.role, lines.next, lines.auto, `${button}:\n${n.url}`, lines.footer].join("\n\n"),
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937;max-width:520px;">
  <div style="background:#e7f3ec;border:1px solid #b7dcc5;border-radius:12px;padding:16px 18px;margin:0 0 18px;">
    <p style="font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#2f7a4f;margin:0 0 6px;">Co-admin nomination</p>
    <p style="font-size:17px;line-height:1.5;font-weight:600;color:#14532d;margin:0;">${esc(nominator)} nominated you as a co-admin of ${esc(n.societyName)}</p>
  </div>
  <p ${p}>${esc(lines.lead)}</p>
  <p ${p}>${esc(lines.role)}</p>
  <p ${p}><strong>What to do next:</strong> ${esc(lines.next)}</p>
  <p ${p}>${esc(lines.auto)}</p>
  <p style="margin:24px 0;"><a href="${esc(n.url)}" style="background:#2f7a4f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block;">${esc(button)}</a></p>
  <p ${small}>Button not working? Copy this link into your browser:<br><a href="${esc(n.url)}" style="color:#2f7a4f;word-break:break-all;">${esc(n.url)}</a></p>
  <p ${small}>${esc(lines.footer)}</p>
</div>`,
  };
}

export function nominationPushMessages(tokens: string[], n: NominationNotice & { requestId: string }): PushMessage[] {
  return tokens.map((to) => ({
    to,
    title: "You've been nominated as a co-admin",
    body: `${who(n)} nominated you as a co-admin of ${n.societyName}. Tap to review.`,
    data: { type: "admin_nomination", requestId: n.requestId },
    sound: "default",
    channelId: "default",
  }));
}
