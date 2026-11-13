// Dispute notice copy (api/ROUTES.md "Dispute notices"): the push + email for
// a dispute response (with or without a settlement offer) and for an accepted
// offer. PURE (no env, no db), so tests can check the copy directly; the
// sending lives in disputeNotice.ts.

import type { Mail } from "../lib/mailer.js";

export type Notice = {
  push: { title: string; body: string };
  mail: Omit<Mail, "to">;
};

/** ₹ with Indian digit grouping; paise only when there are any (₹1,500 / ₹1,500.50). */
export function rupees(paise: number): string {
  const r = paise / 100;
  const whole = Number.isInteger(r);
  return `₹${r.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
}

/** e.g. "14 Nov, 3:30 pm IST". */
export function istTime(at: Date): string {
  const s = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
  return `${s} IST`;
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const name = (n: string) => n.trim() || "The other party";

type Block = { kind: "p"; text: string } | { kind: "rows"; rows: [string, string][] } | { kind: "quote"; label: string; text: string };

/** Paragraphs, key/value rows and a quoted note, then a button + the raw URL (Gmail disables links in Spam). */
function render(subject: string, blocks: Block[], buttonLabel: string, url: string): Omit<Mail, "to"> {
  const text = [
    ...blocks.map((b) =>
      b.kind === "p" ? b.text : b.kind === "rows" ? b.rows.map(([k, v]) => `${k}: ${v}`).join("\n") : `${b.label}:\n"${b.text}"`,
    ),
    `${buttonLabel}:\n${url}`,
    "You're getting this because you're a party to this BorrowVault booking.",
  ].join("\n\n");
  const p = (t: string) => `<p style="font-size:15px;line-height:1.6;margin:0 0 16px;">${esc(t)}</p>`;
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937;max-width:520px;">
${blocks
  .map((b) =>
    b.kind === "p"
      ? p(b.text)
      : b.kind === "rows"
        ? `<table style="border-collapse:collapse;font-size:15px;margin:0 0 16px;">${b.rows
            .map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#6b7280;">${esc(k)}</td><td style="padding:4px 0;font-weight:600;">${esc(v)}</td></tr>`)
            .join("")}</table>`
        : `<p style="font-size:13px;color:#6b7280;margin:0 0 4px;">${esc(b.label)}</p><blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #047857;background:#f0fdf4;font-size:15px;line-height:1.6;white-space:pre-wrap;">${esc(b.text)}</blockquote>`,
  )
  .join("\n")}
  <p style="margin:24px 0;"><a href="${esc(url)}" style="background:#047857;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block;">${esc(buttonLabel)}</a></p>
  <p style="font-size:13px;line-height:1.6;color:#6b7280;">Button not working? Copy this link into your browser:<br><a href="${esc(url)}" style="color:#047857;word-break:break-all;">${esc(url)}</a></p>
  <p style="font-size:13px;line-height:1.6;color:#6b7280;">You're getting this because you're a party to this BorrowVault booking.</p>
</div>`;
  return { subject, text, html };
}

export type ResponseNoticeInput = {
  responderName: string;
  itemTitle: string;
  claimedPaise: number;
  offerPaise: number | null;
  responseText: string;
  /** Pilot society: the BorrowVault team rules, not a society admin. */
  pilot: boolean;
  /** When the dispute escalates to the BorrowVault team; null once it already has. */
  escalatesAt: Date | null;
  url: string;
};

function whoRules(i: Pick<ResponseNoticeInput, "pilot" | "escalatesAt">): string {
  const arbiter = i.pilot ? "The BorrowVault team" : "A society admin who isn't involved";
  const escalation = i.pilot
    ? ""
    : i.escalatesAt
      ? ` If nobody rules by ${istTime(i.escalatesAt)}, it goes to the BorrowVault team.`
      : " It has already gone to the BorrowVault team.";
  return `${arbiter} will compare the evidence and rule.${escalation}`;
}

/** To the raiser, after the other party responds (with or without an offer). */
export function responseNotice(i: ResponseNoticeInput): Notice {
  const who = name(i.responderName);
  const item = i.itemTitle || "your booking";
  if (i.offerPaise != null) {
    const offer = rupees(i.offerPaise);
    return {
      push: { title: `${who} offered ${offer} to settle the dispute on ${item}`, body: "Tap to review and accept the offer." },
      mail: render(
        `${who} offered ${offer} to settle your dispute`,
        [
          { kind: "p", text: `${who} responded to your dispute about ${item} and offered ${offer} to settle it.` },
          { kind: "rows", rows: [["Item", item], ["You claimed", rupees(i.claimedPaise)], ["They offer", offer]] },
          { kind: "quote", label: `${who}'s note`, text: i.responseText },
          {
            kind: "p",
            text: `What to do: accept the offer and the dispute is settled at ${offer} straight away. Or leave it: ${whoRules(i).replace(/^./, (c) => c.toLowerCase())} The offer stays open until then.`,
          },
        ],
        `Review the ${offer} offer`,
        i.url,
      ),
    };
  }
  return {
    push: { title: `${who} responded to your dispute`, body: `${item}: tap to read their response.` },
    mail: render(
      `${who} responded to your dispute`,
      [
        { kind: "p", text: `${who} responded to your dispute about ${item} (you claimed ${rupees(i.claimedPaise)}). They didn't offer a settlement.` },
        { kind: "quote", label: `${who}'s note`, text: i.responseText },
        { kind: "p", text: `What happens next: ${whoRules(i).replace(/^./, (c) => c.toLowerCase())}` },
      ],
      "Open the dispute",
      i.url,
    ),
  };
}

/** To the responder, after the raiser accepts their offer. */
export function offerAcceptedNotice(i: { raiserName: string; itemTitle: string; offerPaise: number; url: string }): Notice {
  const who = name(i.raiserName);
  const offer = rupees(i.offerPaise);
  const item = i.itemTitle || "your booking";
  return {
    push: { title: `${who} accepted your ${offer} offer; dispute settled`, body: `${item}: tap to see what's left to settle.` },
    mail: render(
      `${who} accepted your ${offer} offer; dispute settled`,
      [
        { kind: "p", text: `${who} accepted your ${offer} offer, so the dispute about ${item} is settled.` },
        { kind: "p", text: "Open the booking to see what's left: any amount still owed is paid over UPI from the booking screen." },
      ],
      "Open the booking",
      i.url,
    ),
  };
}
