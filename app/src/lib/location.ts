import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import type { Geo } from "./types";

const MAX_AGE_MS = 30_000;
const SHUTTER_WAIT_MS = 3_000;

function toGeo(l: Location.LocationObject, capturedAt: Date): Geo {
  return {
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    accuracyM: Math.round(l.coords.accuracy ?? 9999),
    capturedAt: capturedAt.toISOString(),
  };
}

export type LocationState = {
  permission: "unknown" | "granted" | "denied";
  /** Latest fix from the background watch, if any. */
  latest: Location.LocationObject | null;
  /** Ask for permission again (e.g. after the user denied it once). */
  request: () => Promise<void>;
  /**
   * The fix to stamp on a shutter press. Never blocks for long: uses the watch
   * fix if it's ≤30 s old, otherwise races a fresh high-accuracy fix against a
   * 3 s timeout, then falls back to the OS last-known fix (≤30 s). Basements kill
   * GPS, and the server flags rather than rejects, so `null` is acceptable.
   */
  shutterFix: (capturedAt: Date) => Promise<Geo | null>;
};

/** High-accuracy watch while a capture screen is mounted. */
export function useLocationFix(): LocationState {
  const [permission, setPermission] = useState<LocationState["permission"]>("unknown");
  const [latest, setLatest] = useState<Location.LocationObject | null>(null);
  const latestRef = useRef<Location.LocationObject | null>(null);
  const subRef = useRef<Location.LocationSubscription | null>(null);

  function start(): Promise<void> {
    return Location.requestForegroundPermissionsAsync()
      .then(async (res) => {
        if (res.status !== "granted") {
          setPermission("denied");
          return;
        }
        setPermission("granted");
        subRef.current?.remove();
        subRef.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Highest, timeInterval: 2_000, distanceInterval: 0 },
          (loc) => {
            latestRef.current = loc;
            setLatest(loc);
          },
        );
      })
      .catch(() => setPermission("denied"));
  }

  useEffect(() => {
    void start();
    return () => {
      subRef.current?.remove();
      subRef.current = null;
    };
  }, []);

  async function shutterFix(capturedAt: Date): Promise<Geo | null> {
    const now = Date.now();
    const w = latestRef.current;
    if (w && now - w.timestamp <= MAX_AGE_MS) return toGeo(w, capturedAt);
    if (permission === "denied") return null;
    try {
      const fresh = await Promise.race<Location.LocationObject | null>([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
        new Promise((resolve) => setTimeout(() => resolve(null), SHUTTER_WAIT_MS)),
      ]);
      if (fresh) return toGeo(fresh, capturedAt);
      const last = await Location.getLastKnownPositionAsync({ maxAge: MAX_AGE_MS });
      return last ? toGeo(last, capturedAt) : null;
    } catch {
      return null;
    }
  }

  return { permission, latest, request: start, shutterFix };
}
