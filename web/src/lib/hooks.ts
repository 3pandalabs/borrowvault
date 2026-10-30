"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type Result<T> = { key: string; data?: T; error?: unknown };

/**
 * Loads `fn()` whenever `key` changes (or reload() is called). Loading is
 * derived from "the last result belongs to a different key" rather than set
 * synchronously inside the effect, which keeps React 19's effect lint rules
 * happy and avoids a flash of stale error state.
 */
export function useAsync<T>(fn: () => Promise<T>, key: string | null) {
  const fnRef = useRef(fn);
  useLayoutEffect(() => {
    fnRef.current = fn;
  });
  const [tick, setTick] = useState(0);
  const fullKey = key === null ? null : `${key}#${tick}`;
  const [res, setRes] = useState<Result<T> | null>(null);

  useEffect(() => {
    if (fullKey === null) return;
    let alive = true;
    fnRef.current().then(
      (data) => alive && setRes({ key: fullKey, data }),
      (error) => alive && setRes({ key: fullKey, error }),
    );
    return () => {
      alive = false;
    };
  }, [fullKey]);

  const loading = fullKey !== null && res?.key !== fullKey;
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback(
    (data: T) => setRes((r) => ({ key: r?.key ?? "", data })),
    [],
  );
  return {
    data: res?.data,
    error: loading ? undefined : res?.error,
    loading,
    reload,
    setData,
  };
}

/** Wraps an async action with busy + error state for buttons/forms. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>, toMessage: (e: unknown) => string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(toMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
