"use client";

// Pending join requests per society the user admins (api/ROUTES.md "Join
// request notice"): drives the count badge on the "Society admin" header link.
// Derived from GET /admin/societies/:id/memberships?status=pending, no extra
// endpoint. One module-level store like offers.ts, so the admin page can
// refresh the badge after a review.

import { useEffect, useSyncExternalStore } from "react";
import { adminMemberships } from "./api";

const POLL_MS = 120_000;

type Counts = Record<string, number>;
const EMPTY: Counts = {};
let current: Counts = EMPTY;
let societyIds: string[] = [];
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Refetch now (deduplicated). A society whose fetch fails keeps its last count. */
export function refreshJoinRequests(): Promise<void> {
  if (inflight) return inflight;
  const ids = societyIds;
  if (!ids.length) return Promise.resolve();
  inflight = Promise.all(
    ids.map((id) =>
      adminMemberships(id, "pending")
        .then((rows) => [id, rows.length] as const)
        .catch(() => [id, current[id] ?? 0] as const),
    ),
  )
    .then((pairs) => {
      // Ignore a result for a society list that changed meanwhile (sign-out, role change).
      if (ids !== societyIds) return;
      current = Object.fromEntries(pairs);
      emit();
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Pending join requests by society id. */
export function useJoinRequestCounts(): Counts {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => EMPTY,
  );
}

/** Mount once in the header with the ids of the societies the user admins; polls only while the tab is visible. */
export function useJoinRequestsPoller(ids: string[]) {
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    societyIds = key.split(",");
    const visible = () => document.visibilityState === "visible";
    void refreshJoinRequests();
    const timer = window.setInterval(() => {
      if (visible()) void refreshJoinRequests();
    }, POLL_MS);
    const onShow = () => {
      if (visible()) void refreshJoinRequests();
    };
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onShow);
      document.removeEventListener("visibilitychange", onShow);
      // Signed out or no longer an admin: don't show the last counts.
      societyIds = [];
      current = EMPTY;
      emit();
    };
  }, [key]);
}
