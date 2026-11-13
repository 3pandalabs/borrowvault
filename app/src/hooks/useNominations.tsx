import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listMyAdminRequests } from "../lib/api";
import { awaitingNominations } from "../lib/nominations";
import type { AdminRequest } from "../lib/types";
import { useAuth } from "./useAuth";
import { usePolling } from "./usePolling";

const POLL_MS = 120_000;
const EMPTY: AdminRequest[] = [];

type NominationsContextValue = {
  /** Co-admin nominations waiting for this user's answer. */
  awaiting: AdminRequest[];
  refresh: () => Promise<void>;
  /** Set from a GET /admin-requests/mine list a screen already fetched. */
  setFrom: (list: AdminRequest[]) => void;
};

const NominationsContext = createContext<NominationsContextValue>({
  awaiting: EMPTY,
  refresh: async () => {},
  setFrom: () => {},
});

/**
 * Drives the green Profile tab badge (api/ROUTES.md "Co-admin nominations").
 * Polls GET /admin-requests/mine every 2 min in the foreground; screens that
 * already loaded the list call `setFrom`, and a nomination push calls `refresh`.
 */
export function NominationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const enabled = !!user;
  const [awaiting, setAwaiting] = useState<AdminRequest[]>(EMPTY);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const setFrom = useCallback((list: AdminRequest[]) => {
    if (enabledRef.current) setAwaiting(awaitingNominations(list));
  }, []);

  const refresh = useCallback(async () => {
    if (!enabledRef.current) return;
    try {
      setFrom(await listMyAdminRequests());
    } catch {
      // keep the last known badge; the next poll tries again
    }
  }, [setFrom]);

  usePolling(refresh, POLL_MS, enabled, true);

  // Signed out: show nothing, even if an old list is still in state.
  const shown = enabled ? awaiting : EMPTY;
  const value = useMemo(() => ({ awaiting: shown, refresh, setFrom }), [shown, refresh, setFrom]);
  return <NominationsContext.Provider value={value}>{children}</NominationsContext.Provider>;
}

export function useNominations(): NominationsContextValue {
  return useContext(NominationsContext);
}
