import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` doesn't connect, so DATABASE_URL is only needed for
// push/introspect. Migrations are applied by src/db/migrate.ts at container start.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://borrowvault:borrowvault@localhost:5434/borrowvault",
  },
  strict: true,
});
