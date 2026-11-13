"use client";

// "Offer waiting" count for the Bookings nav badge: bookings whose nextAction
// is `accept_offer` (api/ROUTES.md), i.e. the other party offered to settle a
// dispute you raised. Derived from GET /bookings, no extra endpoint.

import { useEffect, useSyncExternalStore } from "react";
import { listBookings } from "./api";

const POLL_MS = 60_000;

let current = 0;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Refetch now (deduplicated). Failures keep the last value. */
export function refreshOffers(): Promise<void> {
  if (inflight) return inflight;
  inflight = listBookings()
    .then((rows) => {
      current = rows.filter((b) => b.nextAction === "accept_offer").length;
      emit();
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useOfferCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 0,
  );
}

/** Mount once while signed in with an approved membership; polls only while the tab is visible. */
export function useOfferPoller(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const visible = () => document.visibilityState === "visible";
    void refreshOffers();
    const timer = window.setInterval(() => {
      if (visible()) void refreshOffers();
    }, POLL_MS);
    const onShow = () => {
      if (visible()) void refreshOffers();
    };
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onShow);
      document.removeEventListener("visibilitychange", onShow);
      current = 0;
      emit();
    };
  }, [enabled]);
}
