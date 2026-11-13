import { useSyncExternalStore } from "react";
import { listBookings } from "./api";

// "Offer waiting" count for the My bookings tab badge: bookings whose nextAction
// is `accept_offer` (api/ROUTES.md), i.e. the other party offered to settle a
// dispute you raised. Derived from GET /bookings, no extra endpoint.

let count = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Refetch now. Failures keep the last value. */
export async function refreshOffers(): Promise<void> {
  try {
    const rows = await listBookings({});
    const next = rows.filter((b) => b.nextAction === "accept_offer").length;
    if (next !== count) {
      count = next;
      emit();
    }
  } catch {
    // offline: keep the last badge; the next poll tries again
  }
}

/** Signed out: don't show the last user's count to the next one. */
export function resetOffers(): void {
  count = 0;
  emit();
}

export function useOfferCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => count,
    () => 0,
  );
}
