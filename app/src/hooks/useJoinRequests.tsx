import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listSocietyMemberships } from "../lib/api";
import { adminSocietyIds, pendingTotal } from "../lib/joinRequests";
import { useAuth } from "./useAuth";
import { usePolling } from "./usePolling";

const POLL_MS = 120_000;
const EMPTY: Record<string, number> = {};

type JoinRequestsContextValue = {
  /** Pending join requests by society id (societies the user admins). */
  counts: Record<string, number>;
  total: number;
  refresh: () => Promise<void>;
};

const JoinRequestsContext = createContext<JoinRequestsContextValue>({ counts: EMPTY, total: 0, refresh: async () => {} });

/**
 * Residents waiting for this admin's approval (api/ROUTES.md "Join request
 * notice"): the Profile tab count and the profile banner. Polls
 * GET /admin/societies/:id/memberships?status=pending for each society the
 * user admins, every 2 min in the foreground; a join-request push and the
 * join-requests screen call `refresh`. Does nothing for non-admins.
 */
export function JoinRequestsProvider({ children }: { children: ReactNode }) {
  const { user, memberships } = useAuth();
  const ids = useMemo(() => (user ? adminSocietyIds(memberships) : []), [user, memberships]);
  const key = ids.join(",");
  const [counts, setCounts] = useState<Record<string, number>>(EMPTY);
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  const refresh = useCallback(async () => {
    const asked = keyRef.current;
    if (!asked) return;
    const pairs = await Promise.all(
      asked.split(",").map(async (id) => {
        try {
          return [id, (await listSocietyMemberships(id, "pending")).length] as const;
        } catch {
          return null; // keep that society's last count; the next poll tries again
        }
      }),
    );
    if (keyRef.current !== asked) return; // signed out or role changed meanwhile
    setCounts((cur) => {
      const next: Record<string, number> = {};
      for (const id of asked.split(",")) next[id] = cur[id] ?? 0;
      for (const p of pairs) if (p) next[p[0]] = p[1];
      return next;
    });
  }, []);

  // A new set of admin societies (sign-in, promotion) fetches straight away.
  useEffect(() => {
    if (key) void refresh();
  }, [key, refresh]);
  usePolling(refresh, POLL_MS, !!key);

  // Not an admin (or signed out): show nothing, even if old counts are in state.
  const shown = key ? counts : EMPTY;
  const value = useMemo(() => ({ counts: shown, total: pendingTotal(shown), refresh }), [shown, refresh]);
  return <JoinRequestsContext.Provider value={value}>{children}</JoinRequestsContext.Provider>;
}

export function useJoinRequests(): JoinRequestsContextValue {
  return useContext(JoinRequestsContext);
}
