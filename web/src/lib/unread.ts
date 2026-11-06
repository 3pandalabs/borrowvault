"use client";

// Unread-message counts for the "Messages" nav badge (GET /conversations/unread).
// One module-level store so the header, the inbox and an open chat share one
// number, and a chat that marks itself read can refresh the badge at once.

import { useEffect, useSyncExternalStore } from "react";
import { getUnread } from "./api";
import type { UnreadCounts } from "./types";

const POLL_MS = 30_000;

let current: UnreadCounts | null = null;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Refetch the counts now (deduplicated). Failures keep the last value. */
export function refreshUnread(): Promise<void> {
  if (inflight) return inflight;
  inflight = getUnread()
    .then((u) => {
      current = u;
      emit();
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useUnread(): UnreadCounts | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/**
 * Mount once while signed in: fetches on mount, every 30 s while the tab is
 * visible, and again whenever the tab regains focus. Hidden tabs don't poll.
 */
export function useUnreadPoller() {
  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    void refreshUnread();
    const timer = window.setInterval(() => {
      if (visible()) void refreshUnread();
    }, POLL_MS);
    const onShow = () => {
      if (visible()) void refreshUnread();
    };
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onShow);
      document.removeEventListener("visibilitychange", onShow);
      // Signed out: don't show the last user's count to the next one.
      current = null;
      emit();
    };
  }, []);
}
