// Demo data: one live society "Demo Heights" (towers A and B), a platform
// admin, and a society admin. Idempotent; safe to re-run.
//
// NOT run at container start (unlike RsvpVault's template seed): it creates
// accounts. Run it by hand: `npm run seed` (dev) or `node dist/db/seed.js`.
// Credentials come from env; nothing is hardcoded:
//   SEED_PLATFORM_ADMIN_EMAIL / SEED_PLATFORM_ADMIN_PASSWORD
//   SEED_SOCIETY_ADMIN_EMAIL  / SEED_SOCIETY_ADMIN_PASSWORD
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { hashSecret } from "../auth/password.js";
import * as schema from "./schema.js";

const { memberships, societies, towers, units, users } = schema;

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for the seed (see .env.example)`);
  return v;
}

const DATABASE_URL = need("DATABASE_URL");
const platformEmail = need("SEED_PLATFORM_ADMIN_EMAIL").toLowerCase();
const platformPassword = need("SEED_PLATFORM_ADMIN_PASSWORD");
const societyEmail = need("SEED_SOCIETY_ADMIN_EMAIL").toLowerCase();
const societyPassword = need("SEED_SOCIETY_ADMIN_PASSWORD");
for (const [n, p] of [["SEED_PLATFORM_ADMIN_PASSWORD", platformPassword], ["SEED_SOCIETY_ADMIN_PASSWORD", societyPassword]]) {
  if (p.length < 10) throw new Error(`${n} must be at least 10 characters`);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

async function upsertUser(email: string, password: string, displayName: string, isPlatformAdmin: boolean) {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) {
    await db.update(users).set({ isPlatformAdmin: existing.isPlatformAdmin || isPlatformAdmin }).where(eq(users.id, existing.id));
    return existing.id;
  }
  const [u] = await db
    .insert(users)
    .values({ email, passwordHash: await hashSecret(password), displayName, phone: "+910000000000", isPlatformAdmin })
    .returning({ id: users.id });
  return u.id;
}

const platformAdminId = await upsertUser(platformEmail, platformPassword, "3PandaLabs Ops", true);
const societyAdminId = await upsertUser(societyEmail, societyPassword, "Demo Heights Admin", false);

let [society] = await db.select().from(societies).where(eq(societies.name, "Demo Heights"));
if (!society) {
  [society] = await db
    .insert(societies)
    .values({
      name: "Demo Heights",
      city: "Bengaluru",
      centerLat: 12.9716,
      centerLng: 77.5946,
      radiusM: 300,
      status: "live",
      settings: { depositMode: "declared" },
    })
    .returning();
}

const towerIds: Record<string, string> = {};
for (const name of ["A", "B"]) {
  await db.insert(towers).values({ societyId: society.id, name }).onConflictDoNothing();
  const [t] = await db.select().from(towers).where(and(eq(towers.societyId, society.id), eq(towers.name, name)));
  towerIds[name] = t.id;
}

await db.insert(units).values({ towerId: towerIds.A, flatNo: "101" }).onConflictDoNothing();
const [unit] = await db.select().from(units).where(and(eq(units.towerId, towerIds.A), eq(units.flatNo, "101")));

await db
  .insert(memberships)
  .values({
    userId: societyAdminId,
    societyId: society.id,
    unitId: unit.id,
    role: "society_admin",
    status: "approved",
    occupancy: "owner",
    via: "platform",
    approvedBy: platformAdminId,
    approvedAt: new Date(),
  })
  .onConflictDoNothing();

await pool.end();
console.log(`Seeded "Demo Heights" (${society.id}): towers A/B, platform admin ${platformEmail}, society admin ${societyEmail} (A-101).`);
