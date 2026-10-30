import { defineConfig } from "vitest/config";

// Pure-unit tests: no Postgres, Temporal or R2 needed. Modules under test
// don't import env.ts (transition.ts takes its transaction as a parameter).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
