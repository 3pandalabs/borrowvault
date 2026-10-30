"use client";

import QRCode from "qrcode";
import { Copy, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";

function parseIntent(intent: string) {
  try {
    const q = new URLSearchParams(intent.split("?")[1] ?? "");
    return { pa: q.get("pa"), am: q.get("am"), tn: q.get("tn") };
  } catch {
    return { pa: null, am: null, tn: null };
  }
}

/**
 * A UPI intent (upi://pay?...) as a QR code for desktop (scan with any UPI
 * app) plus an "Open UPI app" deep link for phones. Money goes straight to the
 * VPA in the intent; BorrowVault never touches it.
 */
export function UpiPay({ intent, label }: { intent: string; label: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { pa, am, tn } = parseIntent(intent);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(intent, { margin: 1, width: 220 }).then(
      (url) => alive && setQr(url),
      () => alive && setQr(null),
    );
    return () => {
      alive = false;
    };
  }, [intent]);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line p-4 sm:flex-row sm:items-center">
      <div className="hidden shrink-0 sm:block">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- generated data URL
          <img src={qr} alt={`UPI QR code: ${label}`} width={160} height={160} className="rounded-lg border border-line" />
        ) : (
          <div className="size-40 animate-pulse rounded-lg bg-zinc-100" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <p className="font-medium">{label}</p>
        {am ? <p className="text-2xl font-semibold">₹{Number(am).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p> : null}
        {pa ? (
          <p className="flex items-center gap-2 text-fg-muted">
            To <span className="font-mono text-fg">{pa}</span>
            <button
              type="button"
              aria-label="Copy UPI ID"
              onClick={() => {
                navigator.clipboard?.writeText(pa).then(() => setCopied(true), () => undefined);
              }}
            >
              <Copy className="size-3.5" />
            </button>
            {copied ? <span className="text-xs text-accent">Copied</span> : null}
          </p>
        ) : null}
        {tn ? <p className="text-xs text-fg-muted">Note: {tn}</p> : null}
        <p className="hidden text-xs text-fg-muted sm:block">Scan with any UPI app (GPay, PhonePe, Paytm, BHIM).</p>
        <a href={intent}>
          <Button type="button" size="sm" variant="dark">
            <Smartphone /> Open UPI app
          </Button>
        </a>
      </div>
    </div>
  );
}
