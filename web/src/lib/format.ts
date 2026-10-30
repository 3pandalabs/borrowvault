// Money is integer paise in the API; shown as ₹ with Indian digit grouping.
// Times are UTC ISO strings in the API; shown in Asia/Kolkata, because every
// party to a booking is in the same society and should read one clock.

export const TZ = "Asia/Kolkata";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export function formatINR(paise: number | null | undefined): string {
  if (paise == null) return "—";
  return inr.format(paise / 100);
}

/** "350" or "350.50" → 35000 / 35050. Returns null for blank/invalid input. */
export function rupeesToPaise(input: string): number | null {
  const s = input.trim().replace(/,/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function paiseToRupeesInput(paise: number | null | undefined): string {
  if (paise == null) return "";
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

export function formatIST(iso: string | null | undefined, opts: { date?: boolean; time?: boolean } = {}): string {
  if (!iso) return "—";
  const { date = true, time = true } = opts;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TZ,
    ...(date ? { weekday: "short", day: "numeric", month: "short" } : {}),
    ...(time ? { hour: "numeric", minute: "2-digit", hour12: true } : {}),
  }).format(new Date(iso));
}

export function formatRange(startIso: string, endIso: string): string {
  return `${formatIST(startIso)} → ${formatIST(endIso)}`;
}

/** "in 23h 12m" / "4h ago". */
export function formatCountdown(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const d = Math.floor(h / 24);
  const txt = d >= 2 ? `${d}d ${h % 24}h` : `${h}h ${m}m`;
  return ms >= 0 ? `in ${txt}` : `${txt} ago`;
}

/**
 * <input type="datetime-local"> value interpreted as Asia/Kolkata wall time
 * (UTC+5:30, no DST), converted to a UTC ISO string. Interpreting it in the
 * browser's own zone would book the wrong hour for anyone travelling.
 */
export function istLocalToIso(local: string): string {
  // local = "YYYY-MM-DDTHH:mm"
  return new Date(`${local}:00+05:30`).toISOString();
}

export function isoToIstLocal(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return d.toISOString().slice(0, 16);
}

// Same pattern as the API's PATCH /me validation (ROUTES.md).
export const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

export const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;
