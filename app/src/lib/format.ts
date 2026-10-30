// ₹ and Asia/Kolkata formatting without relying on Hermes' Intl data.
// India has no DST, so IST is a fixed UTC+05:30 offset.
// No React Native imports here: Node runs this file directly in the tests.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Indian digit grouping: 12,34,567 */
function groupIndian(intStr: string): string {
  if (intStr.length <= 3) return intStr;
  const last3 = intStr.slice(-3);
  const rest = intStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** 123456 paise → "₹1,234.56"; whole rupees drop the decimals ("₹3,000"). */
export function formatPaise(paise: number | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (paise === null || paise === undefined || Number.isNaN(paise)) return "—";
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const showDecimals = opts.decimals ?? p !== 0;
  const body = groupIndian(String(rupees)) + (showDecimals ? `.${String(p).padStart(2, "0")}` : "");
  return `${neg ? "-" : ""}₹${body}`;
}

/** "350" / "350.5" / "₹1,200" typed by a user → integer paise, or null if invalid. */
export function rupeesToPaise(input: string): number | null {
  const s = input.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [r, d = ""] = s.split(".");
  return Number(r) * 100 + Number(d.padEnd(2, "0"));
}

export function paiseToRupeesInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type IstParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

/** Wall-clock parts of an instant in Asia/Kolkata (month is 0-based). */
export function istParts(d: Date | string): IstParts {
  const t = (typeof d === "string" ? new Date(d) : d).getTime() + IST_OFFSET_MS;
  const x = new Date(t);
  return {
    year: x.getUTCFullYear(),
    month: x.getUTCMonth(),
    day: x.getUTCDate(),
    hour: x.getUTCHours(),
    minute: x.getUTCMinutes(),
    weekday: x.getUTCDay(),
  };
}

/** The UTC instant for an IST wall-clock time (month is 0-based). */
export function fromIst(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month, day, hour, minute) - IST_OFFSET_MS);
}

function time12(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** "Sun 3 Nov, 10:00 AM" in IST. */
export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const p = istParts(iso);
  return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month]}, ${time12(p.hour, p.minute)}`;
}

/** "Sun 3 Nov 2026" in IST. */
export function formatDate(iso: string | Date): string {
  const p = istParts(iso);
  return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month]} ${p.year}`;
}

/** "10:00 AM" in IST. */
export function formatTime(iso: string | Date): string {
  const p = istParts(iso);
  return time12(p.hour, p.minute);
}

/** "23h 12m", "4m 05s", "2d 3h"; "0s" once passed. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

export function formatStateLabel(state: string): string {
  return state.charAt(0) + state.slice(1).toLowerCase().replace(/_/g, " ");
}
