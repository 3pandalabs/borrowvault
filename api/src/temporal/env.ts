import "dotenv/config";

// Kept separate from ../env.js so the Temporal client/worker config doesn't
// drag in every API env check (copied from RentVault).
export const temporalEnv = {
  address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "borrowvault",
};
