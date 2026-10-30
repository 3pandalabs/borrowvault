import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  ApiError,
  friendlyError,
  getMe,
  hasSession,
  login as apiLogin,
  logout as apiLogout,
  setSessionExpiredHandler,
  signup as apiSignup,
} from "../lib/api";
import { registerForPush } from "../lib/push";
import type { Membership, User } from "../lib/types";

type AuthContextValue = {
  user: User | null;
  memberships: Membership[];
  approved: Membership[];
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (input: { email: string; password: string; displayName: string; phone: string }) => Promise<{
    error: string | null;
  }>;
  signOut: () => Promise<void>;
  /** Re-fetch GET /me (memberships, trust, upiVpa). */
  refresh: () => Promise<void>;
  setUser: (u: User) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await getMe();
      setUser(me.user);
      setMemberships(me.memberships);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        setMemberships([]);
      }
      // offline: keep what we have
    }
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setMemberships([]);
    });
    (async () => {
      if (await hasSession()) await refresh();
      setIsLoading(false);
    })();
    return () => setSessionExpiredHandler(null);
  }, [refresh]);

  useEffect(() => {
    if (user) void registerForPush();
  }, [user]);

  async function signIn(email: string, password: string) {
    try {
      await apiLogin(email.trim(), password);
      await refresh();
      return { error: null };
    } catch (err) {
      return { error: friendlyError(err) };
    }
  }

  async function signUp(input: { email: string; password: string; displayName: string; phone: string }) {
    try {
      await apiSignup(input);
      await refresh();
      return { error: null };
    } catch (err) {
      return { error: friendlyError(err) };
    }
  }

  async function signOut() {
    await apiLogout();
    setUser(null);
    setMemberships([]);
  }

  const approved = memberships.filter((m) => m.status === "approved");

  return (
    <AuthContext.Provider
      value={{ user, memberships, approved, isLoading, signIn, signUp, signOut, refresh, setUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
