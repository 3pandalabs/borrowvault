import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import { sweepDueNominations } from "../lib/adminApproval.js";
import { rollupPlatformStats } from "../lib/platformStats.js";
import * as activities from "./activities/index.js";
import { temporalEnv } from "./env.js";

// Separate deploy (Dockerfile.worker, Coolify resource `borrowvault-worker`).
// Activities do real DB/R2/mail work, so it needs the same env as the API
// plus TEMPORAL_*.
//
// The workflow bundler reads workflows/index.{ts,js} off disk; match this
// module's extension so it works under `tsx watch` and as compiled dist/.
const workflowsPath = fileURLToPath(new URL(`./workflows/index${extname(import.meta.url)}`, import.meta.url));

// Co-admin nominations: approve the ones whose 48 h are up (api/ROUTES.md
// "Co-admin nominations"). A plain DB sweep, not a Temporal timer: it is
// idempotent, survives restarts by construction, and read paths in the API run
// the same check as a backstop, so a missed tick only delays the role change.
const NOMINATION_SWEEP_MS = 5 * 60_000;

function startNominationSweep(): void {
  const tick = () => {
    void sweepDueNominations().then((n) => {
      if (n) console.log(`borrowvault-worker: auto-approved ${n} co-admin nomination(s)`);
    });
  };
  tick();
  setInterval(tick, NOMINATION_SWEEP_MS).unref();
}

// Lifetime stats (api/ROUTES.md "Lifetime stats"): non-personal per-society,
// per-day counts that survive the 3-year purge. Same pattern as the
// nomination sweep: a plain idempotent DB upsert. It runs hourly so today's row
// stays fresh; each run recomputes only the last 3 days (and backfills
// everything on the first run).
const STATS_ROLLUP_MS = 60 * 60_000;

function startStatsRollup(): void {
  const tick = () => {
    void rollupPlatformStats().then((r) => {
      if (r?.backfill) console.log(`borrowvault-worker: platform stats backfilled (${r.rows} row(s))`);
    });
  };
  tick();
  setInterval(tick, STATS_ROLLUP_MS).unref();
}

async function run() {
  startNominationSweep();
  startStatsRollup();
  const connection = await NativeConnection.connect({ address: temporalEnv.address });
  try {
    const worker = await Worker.create({
      connection,
      namespace: temporalEnv.namespace,
      taskQueue: temporalEnv.taskQueue,
      workflowsPath,
      activities,
    });
    console.log(`borrowvault-worker: polling task queue "${temporalEnv.taskQueue}" at ${temporalEnv.address}`);
    await worker.run();
  } finally {
    await connection.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
