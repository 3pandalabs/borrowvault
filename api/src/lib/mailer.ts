import { env } from "../env.js";

// Sends through the shared org email gateway (3pandalabs/mailer), copied from
// RsvpVault. Templates stay in this app; the gateway is a dumb transport.
//
// BorrowVault has NO verified sender yet (Resend holds one domain and it is
// rsvpvault's), so in Phase 1 the gateway is expected to refuse or the env to
// be unset. EVERY send therefore fails soft: logged and counted, never thrown.
// No booking action may fail because an email didn't go out.

export type Mail = { to: string; subject: string; html: string; text: string };

export type SendResult = { delivered: number; failed: number; skipped: number };

export function mailerConfigured(): boolean {
  return Boolean(env.MAILER_URL && env.MAILER_TOKEN);
}

const BATCH = 50;

export async function sendMail(messages: Mail[], log: (msg: string) => void): Promise<SendResult> {
  if (messages.length === 0) return { delivered: 0, failed: 0, skipped: 0 };
  if (!mailerConfigured()) {
    log(`mailer not configured; ${messages.length} message(s) not delivered`);
    return { delivered: 0, failed: 0, skipped: messages.length };
  }

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
