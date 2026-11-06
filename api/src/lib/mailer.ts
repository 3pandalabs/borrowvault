import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env.js";

// Production sends over SMTP (Gmail app password, SMTP_* in env.ts): the shared
// org gateway (3pandalabs/mailer) has no verified sender for BorrowVault, since
// Resend's one free domain is rsvpvault's. The gateway path stays as the
// fallback when SMTP is unset. Templates stay in this app.
//
// EVERY send fails soft: logged and counted, never thrown.
// No booking action may fail because an email didn't go out.

export type Mail = { to: string; subject: string; html: string; text: string };

export type SendResult = { delivered: number; failed: number; skipped: number };

function smtpConfigured(): boolean {
  return Boolean(env.SMTP_USER && env.SMTP_PASS);
}

export function mailerConfigured(): boolean {
  return smtpConfigured() || Boolean(env.MAILER_URL && env.MAILER_TOKEN);
}

let transport: Transporter | null = null;
function smtp(): Transporter {
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    // Google shows app passwords as four groups; spaces are not part of it.
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS.replace(/\s+/g, "") },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transport;
}

async function sendViaSmtp(messages: Mail[], log: (msg: string) => void): Promise<SendResult> {
  const from = { name: env.EMAIL_FROM_NAME || "BorrowVault", address: env.SMTP_USER };
  let delivered = 0;
  let failed = 0;
  for (const m of messages) {
    try {
      await smtp().sendMail({ from, to: m.to, subject: m.subject, html: m.html, text: m.text });
      delivered++;
    } catch (err) {
      log(`smtp send failed: ${String(err)}`);
      failed++;
    }
  }
  return { delivered, failed, skipped: 0 };
}

const BATCH = 50;

export async function sendMail(messages: Mail[], log: (msg: string) => void): Promise<SendResult> {
  if (messages.length === 0) return { delivered: 0, failed: 0, skipped: 0 };
  if (!mailerConfigured()) {
    log(`mailer not configured; ${messages.length} message(s) not delivered`);
    return { delivered: 0, failed: 0, skipped: messages.length };
  }
  if (smtpConfigured()) return sendViaSmtp(messages, log);

  let delivered = 0;
  let failed = 0;
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH);
    try {
      const res = await fetch(`${env.MAILER_URL.replace(/\/$/, "")}/send`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.MAILER_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          app: "borrowvault",
          messages: batch.map((m) => ({
            to: m.to,
            fromName: env.EMAIL_FROM_NAME || "BorrowVault",
            subject: m.subject,
            html: m.html,
            text: m.text,
          })),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        log(`mailer gateway error ${res.status}: ${body.slice(0, 300)}`);
        failed += batch.length;
        continue;
      }
      const result = (await res.json()) as { delivered?: number; failed?: number };
      delivered += result.delivered ?? 0;
      failed += result.failed ?? 0;
    } catch (err) {
      log(`mailer gateway unreachable: ${String(err)}`);
      failed += batch.length;
    }
  }
  return { delivered, failed, skipped: 0 };
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain notification: one paragraph + optional link. Fail-soft like sendMail. */
export function simpleMail(to: string, subject: string, text: string, link?: string): Mail {
  const url = link ? `${env.WEB_ORIGIN}${link}` : null;
  return {
    to,
    subject,
    text: url ? `${text}\n\n${url}` : text,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937;max-width:520px;">
  <p style="font-size:15px;line-height:1.6;">${esc(text)}</p>
  ${url ? `<p><a href="${esc(url)}">Open BorrowVault</a></p>` : ""}
</div>`,
  };
}
