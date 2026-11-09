// Pure day maths for the lifetime stats rollup (platformStats.ts). No DB
// import, so tests can load it without env.

export const STATS_TZ = "Asia/Kolkata";
export const RECOMPUTE_DAYS = 3;

/** The calendar day (YYYY-MM-DD) of `at` in India. */
export function istDay(at: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: STATS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/**
 * First IST day this run recomputes: null = everything (backfill, when the
 * table is empty), else today minus RECOMPUTE_DAYS - 1 days.
 */
export function recomputeFrom(now: Date, tableEmpty: boolean): string | null {
  if (tableEmpty) return null;
  const d = new Date(`${istDay(now)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (RECOMPUTE_DAYS - 1));
  return d.toISOString().slice(0, 10);
}
