import type { SocietyGeofence } from "./types";

/** Great-circle distance in metres. */
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Mirrors the server rule in blueprint §1.2: distance ≤ radius + min(accuracy, 100). */
export function insideFence(fence: SocietyGeofence, lat: number, lng: number, accuracyM: number): boolean {
  return haversineM(fence.centerLat, fence.centerLng, lat, lng) <= fence.radiusM + Math.min(accuracyM, 100);
}
