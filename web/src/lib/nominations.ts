"use client";

// Co-admin nominations waiting for the signed-in user (api/ROUTES.md
// "Co-admin nominations"): drives the green dot on Profile, the profile banner
// and the count on "My admin requests". One module-level store, like unread.ts,
// so the header and the pages share one list, and answering a nomination can
// refresh the dot at once.

import { useEffect, useSyncExternalStore } from "react";
import { myAdminRequests } from "./api";
import type { AdminRequest } from "./types";

const POLL_MS = 120_000;

/** Rows of GET /admin-requests/mine always have the caller as requester (= nominee). */
export function awaitingNominations(list: AdminRequest[] | null | undefined): AdminRequest[] {
  return (list ?? []).filter((r) => r.kind === "nominate_admin" && r.status === "nominated");
}

const EMPTY: AdminRequest[] = [];
let current: AdminRequest[] = EMPTY;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Set straight from a list the page already fetched (no extra request). */
export function setNominationsFrom(list: AdminRequest[]) {
  current = awaitingNominations(list);
  emit();
}

/** Refetch now (deduplicated). Failures keep the last value. */
export function refreshNominations(): Promise<void> {
  if (inflight) return inflight;
  inflight = myAdminRequests()
    .then(setNominationsFrom)
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useAwaitingNominations(): AdminRequest[] {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => EMPTY,
  );
}

/** Mount once while signed in: fetches on mount, every 2 min while visible, and on focus. */
export function useNominationsPoller() {
  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    void refreshNominations();
    const timer = window.setInterval(() => {
      if (visible()) void refreshNominations();
    }, POLL_MS);
    const onShow = () => {
      if (visible()) void refreshNominations();
    };
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onShow);
      document.removeEventListener("visibilitychange", onShow);
      // Signed out: don't show the last user's nominations to the next one.
      current = EMPTY;
      emit();
    };
  }, []);
}
