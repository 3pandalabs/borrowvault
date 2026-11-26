// "BorrowVault New user" email to the org inbox whenever someone signs up
// (2026-11-26, owner request; same shape as AdVault's newUserAlert.ts).
//
// Which paths alert: only POST /auth/signup, and only when the insert actually
// created a row (a taken email hits onConflictDoNothing and sends nothing).
// No alert: db/seed.ts (prod seed logins), test fixtures. There is no
// admin-create or backfill path for users today; add a call here only for a
// real self-serve sign-up.
//
// Fire-and-forget: never awaited by the signup, never throws into it; a send
// failure only logs. NEW_USER_ALERT_EMAIL overrides the recipient; "off" turns
// it off. PURE (no env.ts, no db), so it's unit-tested: routes pass in the
// real sendMail/mailerConfigured from mailer.ts.

import type { Mail, SendResult } from "./mailer.js";

export const DEFAULT_NEW_USER_ALERT_TO = "3pandas@3pandalabs.com";

export function newUserAlertTo(raw = process.env.NEW_USER_ALERT_EMAIL): string | null {
  const v = raw?.trim();
  if (v?.toLowerCase() === "off") return null;
  return v || DEFAULT_NEW_USER_ALERT_TO;
}

export type NewUser = {
  userId: string;
  email: string;
  phone?: string | null;
  displayName?: string | null;
  societyName?: string | null;
  at?: Date;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim().slice(0, 200);

export function newUserMail(to: string, u: NewUser): Mail {
  const at = (u.at ?? new Date()).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const rows: [string, string][] = [["App", "BorrowVault"], ["Email", oneLine(u.email)]];
  if (u.phone) rows.push(["Phone", oneLine(u.phone)]);
  if (u.displayName) rows.push(["Name", oneLine(u.displayName)]);
  if (u.societyName) rows.push(["Society", oneLine(u.societyName)]);
  rows.push(["Signed up", at], ["User id", u.userId]);
  return {
    to,
    subject: "BorrowVault New user",
    text: `New BorrowVault sign-up.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937;max-width:560px">
  <p style="font-size:15px"><b>New BorrowVault sign-up</b></p>
  <table style="font-size:14px;border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="color:#6b7280;padding:2px 12px 2px 0">${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join("")}</table>
</div>`,
  };
}

export type AlertDeps = {
  send: (messages: Mail[], log: (msg: string) => void) => Promise<SendResult>;
  configured: () => boolean;
};

/** Sends the alert in the background. Never throws, never awaited by the signup. */
export function notifyNewUser(u: NewUser, log: (msg: string) => void, deps: AlertDeps): void {
  try {
    const to = newUserAlertTo();
    if (!to || !deps.configured()) return;
    void deps.send([newUserMail(to, u)], log).then(
      (r) => {
        if (r.failed > 0) log(`new user alert not delivered (${r.failed} failed)`);
      },
      (err) => log(`new user alert failed: ${String(err)}`),
    );
  } catch (err) {
    log(`new user alert failed: ${String(err)}`);
  }
}
