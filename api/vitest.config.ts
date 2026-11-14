import { defineConfig } from "vitest/config";

// Pure-unit tests: no Postgres, Temporal or R2 needed. Modules under test
// don't import env.ts (transition.ts takes its transaction as a parameter).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // The *.db.test.ts files each drop and re-migrate the TEST_DATABASE_URL
    // schema, so with a database they must not run at the same time.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
