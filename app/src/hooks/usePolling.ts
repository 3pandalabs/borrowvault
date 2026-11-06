import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

/**
 * Calls `fn` every `ms` while `enabled` and the app is in the foreground. Pauses in the
 * background and calls `fn` once immediately on coming back. Ticks never overlap: a tick
 * is skipped while the previous call is still running. `immediate` also calls it as soon as polling starts.
 */
export function usePolling(fn: () => Promise<unknown> | void, ms: number, enabled = true, immediate = false) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await fnRef.current();
      } catch {
        // pollers handle their own errors; a failed tick just waits for the next one
      } finally {
        running = false;
      }
    };
    const start = () => {
      if (!timer) timer = setInterval(() => void tick(), ms);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === "active") {
      if (immediate) void tick();
      start();
    }
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void tick();
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [ms, enabled, immediate]);
}

/** True while the current screen is focused (cleared on blur). */
export function useIsScreenFocused(): boolean {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}
