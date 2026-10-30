import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities/index.js";
import { temporalEnv } from "./env.js";

// Separate deploy (Dockerfile.worker, Coolify resource `borrowvault-worker`).
// Activities do real DB/R2/mail work, so it needs the same env as the API
// plus TEMPORAL_*.
//
// The workflow bundler reads workflows/index.{ts,js} off disk; match this
// module's extension so it works under `tsx watch` and as compiled dist/.
const workflowsPath = fileURLToPath(new URL(`./workflows/index${extname(import.meta.url)}`, import.meta.url));

async function run() {
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
