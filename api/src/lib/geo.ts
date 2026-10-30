// Evidence geofence (infra/blueprint.md §1.2). Out-of-fence is a FLAG stored
// with the evidence, never a block: basements and lift lobbies kill GPS.

const EARTH_RADIUS_M = 6_371_000;
export const MAX_ACCURACY_ALLOWANCE_M = 100;

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLng = (lng2 - lng1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** distance to the society centre <= radiusM + min(accuracyM, 100) */
export function withinGeofence(
  point: { lat: number; lng: number; accuracyM: number },
  society: { centerLat: number; centerLng: number; radiusM: number },
): boolean {
  const d = haversineM(point.lat, point.lng, society.centerLat, society.centerLng);
  const allowance = Math.min(Math.max(point.accuracyM, 0), MAX_ACCURACY_ALLOWANCE_M);
  return d <= society.radiusM + allowance;
}

export const CLOCK_SKEW_FLAG_MS = 10 * 60_000;

/** Client capture time disagrees with server receipt by more than 10 minutes. */
export function clockSkewed(clientCapturedAt: Date, receivedAt: Date): boolean {
  return Math.abs(receivedAt.getTime() - clientCapturedAt.getTime()) > CLOCK_SKEW_FLAG_MS;
}
