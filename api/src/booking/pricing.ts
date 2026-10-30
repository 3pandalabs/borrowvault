import { HOUR_MS } from "./states.js";

export type Pricing = "hourly" | "daily" | "weekend";

export const MAX_BOOKING_MS = 30 * 24 * HOUR_MS;

const DAY_MS = 24 * HOUR_MS;
// India Standard Time: UTC+05:30, no daylight saving.
const IST_OFFSET_MS = 5.5 * HOUR_MS;

/**
 * The weekend that `start` falls in, as [Fri 12:00 IST, Mon 12:00 IST) in UTC ms,
 * or null if `start` isn't inside any weekend window.
 */
export function weekendWindow(start: Date): { from: number; to: number } | null {
  const ist = new Date(start.getTime() + IST_OFFSET_MS); // read the UTC fields as IST wall-clock
  const dow = ist.getUTCDay(); // 0 Sun .. 6 Sat
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const daysSinceFriday = { 5: 0, 6: 1, 0: 2, 1: 3 }[dow as 5 | 6 | 0 | 1];
  if (daysSinceFriday === undefined) return null;
  if (dow === 5 && minutes < 12 * 60) return null; // Friday morning: not yet the weekend
  if (dow === 1 && minutes >= 12 * 60) return null; // Monday afternoon: weekend is over
  const istMidnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const fridayNoonIst = istMidnight - daysSinceFriday * DAY_MS + 12 * HOUR_MS;
  const from = fridayNoonIst - IST_OFFSET_MS; // back to real UTC
  return { from, to: from + 3 * DAY_MS };
}

/** Fee in integer paise. Throws a plain Error with a user-facing message. */
export function priceFor(
  listing: { hourlyPaise: number | null; dailyPaise: number | null; weekendPaise: number | null },
  pricing: Pricing,
  start: Date,
  end: Date,
): number {
  const ms = end.getTime() - start.getTime();
  if (!(ms > 0)) throw new Error("endsAt must be after startsAt");
  if (ms > MAX_BOOKING_MS) throw new Error("bookings are limited to 30 days");
  switch (pricing) {
    case "hourly":
      if (listing.hourlyPaise == null) throw new Error("this listing has no hourly price");
      return Math.ceil(ms / HOUR_MS) * listing.hourlyPaise;
    case "daily":
      if (listing.dailyPaise == null) throw new Error("this listing has no daily price");
      return Math.ceil(ms / DAY_MS) * listing.dailyPaise;
    case "weekend": {
      if (listing.weekendPaise == null) throw new Error("this listing has no weekend price");
      // Must sit inside one weekend: no earlier than Fri 12:00 IST, no later than Mon 12:00 IST.
      const w = weekendWindow(start);
      if (!w || start.getTime() < w.from || end.getTime() > w.to) {
        throw new Error("a weekend booking must run between Friday 12:00 and Monday 12:00 IST of the same weekend");
      }
      return listing.weekendPaise;
    }
  }
}
