import { type SQL, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { istDay, recomputeFrom, STATS_TZ } from "./statsDays.js";

// Lifetime stats rollup (api/ROUTES.md "Lifetime stats"). Writes non-personal
// per-society, per-IST-day counts into platform_stats_daily so the totals
// survive the 3-year purge of personal data. Counts only: never a user id or
// any text.
//
// Idempotent: each run recomputes whole days from the live tables and upserts
// them. Only the last RECOMPUTE_DAYS days are rewritten, so purging old
// personal data can never lower a stored count. An empty table is backfilled
// from the oldest data.

function log(msg: string): void {
  console.log(`platform-stats: ${msg}`);
}

/** Run the rollup once. Never throws: a failure is logged and the next run retries. */
export async function rollupPlatformStats(now: Date = new Date()): Promise<{ rows: number; backfill: boolean } | null> {
  try {
    return await db.transaction(async (tx) => {
      const existing = await tx.execute<{ any: boolean }>(sql`select exists (select 1 from platform_stats_daily) as any`);
      const from = recomputeFrom(now, !existing.rows[0]?.any);
      // `from` is an IST day; events at or after its IST midnight are recounted.
      const since = from === null ? sql`'-infinity'::timestamptz` : sql`(${from}::date::timestamp at time zone ${STATS_TZ})`;
      const day = (col: SQL) => sql`(${col} at time zone ${STATS_TZ})::date`;

      const events = await tx.execute(sql`
        insert into platform_stats_daily as s
          (day, society_id, bookings_created, bookings_completed, disputes_raised, listings_created, updated_at)
        select d, society_id, sum(bc)::int, sum(bd)::int, sum(dr)::int, sum(lc)::int, now()
        from (
          select ${day(sql`b.created_at`)} as d, b.society_id, 1 as bc, 0 as bd, 0 as dr, 0 as lc
            from bookings b where b.created_at >= ${since}
          union all
          select ${day(sql`f.done_at`)}, b.society_id, 0, 1, 0, 0
            from (select booking_id, min(at) as done_at from booking_events
                  where to_state in ('COMPLETED', 'RESOLVED') group by booking_id) f
            join bookings b on b.id = f.booking_id
            where f.done_at >= ${since}
          union all
          select ${day(sql`x.created_at`)}, b.society_id, 0, 0, 1, 0
            from disputes x join bookings b on b.id = x.booking_id where x.created_at >= ${since}
          union all
          select ${day(sql`l.created_at`)}, l.society_id, 0, 0, 0, 1
            from listings l where l.created_at >= ${since}
        ) e
        group by d, society_id
        on conflict (day, society_id) do update set
          bookings_created = excluded.bookings_created,
          bookings_completed = excluded.bookings_completed,
          disputes_raised = excluded.disputes_raised,
          listings_created = excluded.listings_created,
          updated_at = now()
      `);

      // Today's gauges, for every live society (activity or not).
      const today = istDay(now);
      const gauges = await tx.execute(sql`
        insert into platform_stats_daily as s (day, society_id, listings_active, members, updated_at)
        select ${today}::date, so.id,
          (select count(*) from listings l where l.society_id = so.id and l.status = 'active')::int,
          (select count(*) from memberships m where m.society_id = so.id and m.status = 'approved')::int,
          now()
        from societies so where so.status = 'live'
        on conflict (day, society_id) do update set
          listings_active = excluded.listings_active,
          members = excluded.members,
          updated_at = now()
      `);
      const rows = (events.rowCount ?? 0) + (gauges.rowCount ?? 0);
      return { rows, backfill: from === null };
    });
  } catch (err) {
    log(`rollup failed: ${String(err)}`);
    return null;
  }
}

export type LifetimeTotals = { bookingsCreated: number; bookingsCompleted: number; listingsCreated: number };

export async function lifetimeTotals(): Promise<LifetimeTotals> {
  const r = await db.execute<{ bc: number; bd: number; lc: number }>(sql`
    select coalesce(sum(bookings_created), 0)::int as bc,
           coalesce(sum(bookings_completed), 0)::int as bd,
           coalesce(sum(listings_created), 0)::int as lc
    from platform_stats_daily
  `);
  const row = r.rows[0];
  return { bookingsCreated: row.bc, bookingsCompleted: row.bd, listingsCreated: row.lc };
}
