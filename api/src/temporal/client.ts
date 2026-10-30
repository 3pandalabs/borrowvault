import { Client, Connection } from "@temporalio/client";
import { temporalEnv } from "./env.js";

// Lazy singleton (copied from RentVault). A failed connection is NOT cached,
// so a transient blip doesn't turn into a permanent instant-500.
let clientPromise: Promise<Client> | undefined;

export function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = Connection.connect({ address: temporalEnv.address }).then(
      (connection) => new Client({ connection, namespace: temporalEnv.namespace }),
    );
    clientPromise.catch(() => {
      clientPromise = undefined;
    });
  }
  return clientPromise;
}
