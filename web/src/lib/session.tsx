"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { getMe, getTokens, subscribeTokens } from "./api";
import { useAsync } from "./hooks";
import type { Me, Membership, User } from "./types";

const SOCIETY_KEY = "bv_active_society";
const SOCIETY_EVENT = "bv-society";

function readSociety() {
  try {
    return window.localStorage.getItem(SOCIETY_KEY);
  } catch {
    return null;
  }
}

function subscribeSociety(cb: () => void) {
  window.addEventListener(SOCIETY_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(SOCIETY_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useSignedIn() {
  return useSyncExternalStore(
    subscribeTokens,
    () => getTokens().access !== null || getTokens().refresh !== null,
    () => false,
  );
}

type Session = {
  user: User;
  memberships: Membership[];
  approved: Membership[];
  adminOf: Membership[];
  /** The approved membership whose society the resident pages show. */
  active: Membership | null;
  setActiveSociety: (societyId: string) => void;
  refresh: () => void;
  setMe: (me: Me) => void;
};

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

export function SessionProvider({
  me,
  refresh,
  setMe,
  children,
}: {
  me: Me;
  refresh: () => void;
  setMe: (me: Me) => void;
  children: React.ReactNode;
}) {
  const stored = useSyncExternalStore(subscribeSociety, readSociety, () => null);
  const setActiveSociety = useCallback((id: string) => {
    try {
      window.localStorage.setItem(SOCIETY_KEY, id);
    } catch {
      /* per-viewer convenience only */
    }
    window.dispatchEvent(new Event(SOCIETY_EVENT));
  }, []);

  const value = useMemo<Session>(() => {
    const approved = me.memberships.filter((m) => m.status === "approved");
    const adminOf = approved.filter((m) => m.role === "society_admin");
    const active = approved.find((m) => m.societyId === stored) ?? approved[0] ?? null;
    return { user: me.user, memberships: me.memberships, approved, adminOf, active, setActiveSociety, refresh, setMe };
  }, [me, stored, setActiveSociety, refresh, setMe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMeLoader(enabled: boolean) {
  return useAsync(getMe, enabled ? "me" : null);
}
