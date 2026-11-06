import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { unreadCounts } from "../lib/api";
import type { UnreadCounts } from "../lib/types";
import { useAuth } from "./useAuth";
import { usePolling } from "./usePolling";

const EMPTY: UnreadCounts = { total: 0, byConversation: {} };
const POLL_MS = 30_000;

type UnreadContextValue = UnreadCounts & { refresh: () => Promise<void> };

const UnreadContext = createContext<UnreadContextValue>({ ...EMPTY, refresh: async () => {} });

/**
 * Unread chat counts for the tab badge. Polls GET /conversations/unread every 30 s while the app is
 * in the foreground; screens call `refresh()` after reading or on focus, and a chat push arriving in the
 * foreground triggers one too (usePushNotifications).
 */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const { user, approved } = useAuth();
  const enabled = !!user && approved.length > 0;
  const [counts, setCounts] = useState<UnreadCounts>(EMPTY);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const refresh = useCallback(async () => {
    if (!enabledRef.current) return;
    try {
      const next = await unreadCounts();
      if (enabledRef.current) setCounts(next);
    } catch {
      // keep the last known badge; the next poll tries again
    }
  }, []);

  // Fetches straight away when enabled (sign-in, approval), then every 30 s in the foreground.
  usePolling(refresh, POLL_MS, enabled, true);

  // Signed out: show nothing, even if an old count is still in state.
  const shown = enabled ? counts : EMPTY;
  const value = useMemo(() => ({ ...shown, refresh }), [shown, refresh]);
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export function useUnread(): UnreadContextValue {
  return useContext(UnreadContext);
}
