// Applies drizzle/*.sql migrations. Runs on every container start (Dockerfile
// CMD) as the compiled `node dist/db/migrate.js`.
//
// Runs as the runtime role (DATABASE_URL). `borrowvault_app` owns the
// `borrowvault` database and runs DDL itself. There is no MIGRATION_DATABASE_URL
// on purpose: objects created by a superuser end up owned by `postgres` and the
// runtime role then fails with 42501 (RentVault's drizzle-schema incident).
//
// Every migration file MUST be idempotent (IF NOT EXISTS, DO $$ ... guards):
// a statement that fails on re-run crash-loops the container.
//
// Kept dependency-light (no env.ts import) so it runs without JWT/R2 env.
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const pool = new Pool({ connectionString });
const db = drizzle(pool);

await migrate(db, { migrationsFolder: "./drizzle" });
await pool.end();
console.log("Migrations applied.");
