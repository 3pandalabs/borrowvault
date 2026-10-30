import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { env } from "../env.js";
import { cpuPercentOfOneCore, requestsLastHour } from "../metrics/collector.js";

// Ops-only endpoint scraped server-side by admin.3pandalabs.com. Own bearer
// token (METRICS_TOKEN, optional -> 503), aggregate counts only, nothing that
// identifies a user. The envelope (app/collectedAt/uptimeSeconds/counts/
// traffic/process/database) is shared across every 3PandaLabs app; only the
// `counts` keys are per-app.

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type CountsRow = {
  users: number;
  live_societies: number;
  approved_members: number;
  pending_members: number;
  active_listings: number;
  bookings: number;
  open_bookings: number;
  completed_bookings: number;
  open_disputes: number;
  active_sessions: number;
};

type DatabaseRow = { size_bytes: string; size_pretty: string; connections: number };

export async function metricsRoutes(app: FastifyInstance) {
  app.get("/metrics", async (req, reply) => {
    if (!env.METRICS_TOKEN) return reply.code(503).send({ error: "metrics_disabled" });
    const header = req.headers.authorization ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!tokenMatches(presented, env.METRICS_TOKEN)) return reply.code(401).send({ error: "unauthorized" });

    const counts = await db.execute<CountsRow>(sql`
      select
        (select count(*) from users)::int as users,
        (select count(*) from societies where status = 'live')::int as live_societies,
        (select count(*) from memberships where status = 'approved')::int as approved_members,
        (select count(*) from memberships where status = 'pending')::int as pending_members,
        (select count(*) from listings where status = 'active')::int as active_listings,
        (select count(*) from bookings)::int as bookings,
        (select count(*) from bookings where state in ('REQUESTED','ACCEPTED','DEPOSIT_HELD','HANDOVER_PENDING','ACTIVE','OVERDUE','RETURN_PENDING'))::int as open_bookings,
        (select count(*) from bookings where state in ('COMPLETED','RESOLVED'))::int as completed_bookings,
        (select count(*) from disputes where status <> 'resolved' and status <> 'withdrawn')::int as open_disputes,
        (select count(*) from sessions where expires_at > now())::int as active_sessions
    `);
    const database = await db.execute<DatabaseRow>(sql`
      select
        pg_database_size(current_database()) as size_bytes,
        pg_size_pretty(pg_database_size(current_database())) as size_pretty,
        (select count(*) from pg_stat_activity where datname = current_database())::int as connections
    `);

    const c = counts.rows[0];
    const d = database.rows[0];
    const mem = process.memoryUsage();
    return {
      app: "borrowvault",
      collectedAt: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      counts: {
        users: c.users,
        liveSocieties: c.live_societies,
        approvedMembers: c.approved_members,
        pendingMembers: c.pending_members,
        activeListings: c.active_listings,
        bookings: c.bookings,
        openBookings: c.open_bookings,
        completedBookings: c.completed_bookings,
        openDisputes: c.open_disputes,
        activeSessions: c.active_sessions,
      },
      traffic: { apiRequestsLastHour: requestsLastHour() },
      process: { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed, cpuPercentOfOneCore: cpuPercentOfOneCore() },
      database: { sizeBytes: Number(d.size_bytes), sizePretty: d.size_pretty, connections: d.connections },
    };
  });
}
