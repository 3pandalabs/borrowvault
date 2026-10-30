"use client";

// Typed client for api/ROUTES.md. The whole web app is client-rendered and
// talks to the API straight from the browser (same as RsvpVault's dashboard):
// no server-side fetch means no orange-to-orange problem, and the API's bearer
// check stays the only authorization boundary.

import type {
  AdminDispute,
  AdminMembership,
  AuthResponse,
  Booking,
  BookingDetail,
  BookingState,
  BusyRange,
  CategoryPreset,
  ChecklistAnswer,
  DisputeCategory,
  Geo,
  Inspection,
  InspectionPhase,
  InviteCode,
  Listing,
  ListingInput,
  ListingKind,
  ListingPatch,
  ListingSummary,
  Me,
  MediaMime,
  MediaPhase,
  Membership,
  Occupancy,
  PresignPurpose,
  PricingUnit,
  Rating,
  RatingInput,
  Society,
  SocietyPatch,
  SocietySearchResult,
  Tower,
  User,
} from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * Human message for any thrown value. Error bodies are `{error, code?}` where
 * `error` is already human-readable, so codes only override where we can say
 * something more useful than the server.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "OVERLAP":
        return "Those dates clash with another booking. Pick a different slot.";
      case "TRANSITION_CONFLICT":
        return "This booking moved on while you were looking. Refresh to see where it is now.";
      case "ALREADY_SUBMITTED":
        return "That's already been submitted.";
      case "UNAVAILABLE":
        return "Bookings are briefly unavailable. Nothing was lost; try again in a minute.";
    }
    if (e.status === 429 || e.message === "rate_limited") return "Too many attempts. Wait a minute and try again.";
    if (e.status === 404) return "Not found, or not in your society.";
    if (e.message && e.message !== "request_failed") return e.message;
    if (e.status === 403) return "You can't do that.";
    return "Something went wrong.";
  }
  if (e instanceof TypeError) return "Couldn't reach the server. Check your connection and try again.";
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong.";
}

// ---- tokens ----

const ACCESS_KEY = "bv_access_token";
const REFRESH_KEY = "bv_refresh_token";
const TOKEN_EVENT = "bv-tokens";

export function getTokens() {
  if (typeof window === "undefined") return { access: null, refresh: null };
  try {
    return {
      access: window.localStorage.getItem(ACCESS_KEY),
      refresh: window.localStorage.getItem(REFRESH_KEY),
    };
  } catch {
    return { access: null, refresh: null };
  }
}

export function setTokens(access: string, refresh: string) {
  window.localStorage.setItem(ACCESS_KEY, access);
  window.localStorage.setItem(REFRESH_KEY, refresh);
  window.dispatchEvent(new Event(TOKEN_EVENT));
}

export function clearTokens() {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  window.dispatchEvent(new Event(TOKEN_EVENT));
}

/** Subscribe to token changes in this tab and others (for useSyncExternalStore). */
export function subscribeTokens(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(TOKEN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(TOKEN_EVENT, onChange);
  };
}

// One refresh in flight at a time: refresh tokens rotate, so two parallel 401s
// each spending the same refresh token would log the user out.
let refreshing: Promise<string | null> | null = null;

function refreshTokens(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { refresh } = getTokens();
    if (!refresh) return null;
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) {
        clearTokens();
        return null;
      }
      const data = (await res.json()) as AuthResponse;
      setTokens(data.accessToken, data.refreshToken);
      return data.accessToken;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function toError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  return new ApiError(res.status, body?.error ?? "request_failed", body?.code);
}

type Opts = { method?: string; body?: unknown; auth?: boolean };

async function call<T>(path: string, { method = "GET", body, auth = true }: Opts = {}): Promise<T> {
  const send = (token: string | null) =>
    fetch(`${API_URL}${path}`, {
      method,
      headers: {
        // Only when there IS a body: Fastify rejects a declared-JSON empty body
        // (FST_ERR_CTP_EMPTY_JSON_BODY), which broke bodyless action POSTs in
        // RsvpVault.
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await send(auth ? getTokens().access : null);
  if (auth && res.status === 401) {
    const fresh = await refreshTokens();
    if (!fresh) throw new ApiError(401, "Your session has ended. Please sign in again.");
    res = await send(fresh);
  }
  if (!res.ok) throw await toError(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

function qs(params: Record<string, string | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
}

const enc = encodeURIComponent;

// ---- auth / profile ----

export const signup = (b: { email: string; password: string; displayName: string; phone: string }) =>
  call<AuthResponse>("/auth/signup", { method: "POST", body: b, auth: false });
export const login = (b: { email: string; password: string }) =>
  call<AuthResponse>("/auth/login", { method: "POST", body: b, auth: false });
export async function logout() {
  const { refresh } = getTokens();
  try {
    if (refresh) await call<void>("/auth/logout", { method: "POST", body: { refreshToken: refresh } });
  } finally {
    clearTokens();
  }
}
/** → 204 always (no account enumeration). The email links to /reset-password?token=… */
export const requestPasswordReset = (email: string) =>
  call<void>("/auth/password-reset/request", { method: "POST", body: { email }, auth: false });
/** → 204; 400 `invalid_or_expired_token`. Kills all sessions. */
export const confirmPasswordReset = (token: string, password: string) =>
  call<void>("/auth/password-reset/confirm", { method: "POST", body: { token, password }, auth: false });

export const getMe = () => call<Me>("/me");
export const updateMe = (b: { displayName?: string; phone?: string; upiVpa?: string }) =>
  call<{ user: User }>("/me", { method: "PATCH", body: b });

// ---- societies & membership ----

export const searchSocieties = (q: string) =>
  call<SocietySearchResult[]>(`/societies${qs({ q })}`, { auth: false });
export const getTowers = (societyId: string) =>
  call<Tower[]>(`/societies/${enc(societyId)}/towers`, { auth: false });
export const joinSociety = (
  societyId: string,
  b: { inviteCode?: string; towerId: string; flatNo: string; occupancy: Occupancy; proofKey?: string },
) => call<Membership>(`/societies/${enc(societyId)}/join`, { method: "POST", body: b });

export const presignStorage = (b: { purpose: PresignPurpose; mime: string; bytes: number }) =>
  call<{ key: string; uploadUrl: string }>("/storage/presign", { method: "POST", body: b });
export const storageUrl = (key: string) => call<{ url: string }>(`/storage/url${qs({ key })}`);

/** Presign, then PUT straight to R2. Returns the object key. */
export async function uploadFile(purpose: PresignPurpose, file: File): Promise<string> {
  const { key, uploadUrl } = await presignStorage({ purpose, mime: file.type, bytes: file.size });
  const put = await fetch(uploadUrl, {
    method: "PUT",
    // Must match the content type pinned into the signature.
    headers: { "content-type": file.type },
    body: file,
  });
  if (!put.ok) throw new ApiError(put.status, "Upload failed. Please try again.");
  return key;
}

// ---- society admin ----

export const adminMemberships = (societyId: string, status?: string) =>
  call<AdminMembership[]>(`/admin/societies/${enc(societyId)}/memberships${qs({ status })}`);
export const approveMembership = (id: string, note?: string) =>
  call<Membership>(`/admin/memberships/${enc(id)}/approve`, { method: "POST", body: note ? { note } : {} });
export const rejectMembership = (id: string, note?: string) =>
  call<Membership>(`/admin/memberships/${enc(id)}/reject`, { method: "POST", body: note ? { note } : {} });
export const revokeMembership = (id: string) =>
  call<Membership>(`/admin/memberships/${enc(id)}/revoke`, { method: "POST" });
export const createTower = (societyId: string, name: string) =>
  call<Tower>(`/admin/societies/${enc(societyId)}/towers`, { method: "POST", body: { name } });
export const getSociety = (societyId: string) => call<Society>(`/admin/societies/${enc(societyId)}`);
export const createInviteCode = (societyId: string, towerId: string) =>
  call<{ code: string; expiresAt: string }>(`/admin/societies/${enc(societyId)}/invite-codes`, {
    method: "POST",
    body: { towerId },
  });
export const listInviteCodes = (societyId: string) =>
  call<InviteCode[]>(`/admin/societies/${enc(societyId)}/invite-codes`);
export const patchSociety = (societyId: string, b: SocietyPatch) =>
  call<Society>(`/admin/societies/${enc(societyId)}`, { method: "PATCH", body: b });
export const adminDisputes = (societyId: string, status?: string) =>
  call<AdminDispute[]>(`/admin/societies/${enc(societyId)}/disputes${qs({ status })}`);

// ---- platform admin ----

export const createSociety = (b: {
  name: string;
  city: string;
  centerLat: number;
  centerLng: number;
  radiusM: number;
  adminUserEmail: string;
}) => call<Society>("/platform/societies", { method: "POST", body: b });
export const listPlatformSocieties = () => call<Society[]>("/platform/societies");

// ---- listings ----

export const listListings = (p: {
  societyId?: string;
  kind?: ListingKind | "";
  category?: string;
  q?: string;
  ownerId?: "me";
}) => call<ListingSummary[]>(`/listings${qs(p)}`);
export const getListing = (id: string) => call<Listing>(`/listings/${enc(id)}`);
export const createListing = (b: ListingInput) => call<Listing>("/listings", { method: "POST", body: b });
export const updateListing = (id: string, b: ListingPatch) =>
  call<Listing>(`/listings/${enc(id)}`, { method: "PATCH", body: b });
export const getAvailability = (id: string, from?: string, to?: string) =>
  call<BusyRange[]>(`/listings/${enc(id)}/availability${qs({ from, to })}`);
export const getCategories = () => call<CategoryPreset[]>("/categories", { auth: false });

// ---- bookings ----
// Every POST /bookings/:id/... action returns the fresh BookingDetail, so
// callers render the response instead of refetching.

const bk = (id: string, tail = "") => `/bookings/${enc(id)}${tail}`;
const action = (id: string, tail: string, body?: unknown) =>
  call<BookingDetail>(bk(id, tail), { method: "POST", body });

export const createBooking = (body: { listingId: string; startsAt: string; endsAt: string; pricing: PricingUnit }) =>
  call<Booking>("/bookings", { method: "POST", body });
export const listBookings = (p: { role?: "lender" | "borrower"; state?: BookingState | "" } = {}) =>
  call<Booking[]>(`/bookings${qs(p)}`);
export const getBooking = (id: string) => call<BookingDetail>(bk(id));
export const acceptBooking = (id: string) => action(id, "/accept");
export const declineBooking = (id: string) => action(id, "/decline");
export const cancelBooking = (id: string) => action(id, "/cancel");
export const claimPayment = (id: string, utr?: string) => action(id, "/payment/claim", utr ? { utr } : {});
export const confirmPayment = (id: string) => action(id, "/payment/confirm");

/**
 * The web app never captures handover/return inspection photos (camera-only
 * rule, mobile app). It uses media upload for dispute evidence and ack
 * objection photos, where `geo` is optional (null = no fix, never rejected).
 */
export const presignMedia = (
  id: string,
  body: { phase: MediaPhase; slot: string; mime: MediaMime; bytes: number; sha256: string; geo?: Geo | null },
) => call<{ mediaId: string; uploadUrl: string }>(bk(id, "/media/presign"), { method: "POST", body });
export const finalizeMedia = (id: string, mediaId: string) =>
  call<{ ok: true }>(bk(id, `/media/${enc(mediaId)}/finalize`), { method: "POST" });

export const submitInspection = (
  id: string,
  body: {
    phase: InspectionPhase;
    mediaIds: string[];
    checklistAnswers: Record<string, ChecklistAnswer>;
    geo: Geo | null;
  },
) => call<Inspection>(bk(id, "/inspections"), { method: "POST", body });
export const ackInspection = (
  id: string,
  body: { phase: InspectionPhase; result: "agreed" | "objected"; note?: string; mediaIds?: string[] },
) => action(id, "/inspections/ack", body);

export const raiseDispute = (
  id: string,
  body: { category: DisputeCategory; description: string; claimedPaise: number; mediaIds?: string[] },
) => action(id, "/disputes", body);
export const respondDispute = (id: string, body: { responseText: string; offerPaise?: number }) =>
  action(id, "/disputes/respond", body);
export const acceptOffer = (id: string) => action(id, "/disputes/accept-offer");
export const ruleDispute = (id: string, body: { awardPaise: number; note: string }) =>
  action(id, "/disputes/ruling", body);

export const refundClaim = (id: string) => action(id, "/deposit/refund-claim");
export const refundConfirm = (id: string) => action(id, "/deposit/refund-confirm");
export const awardPaidClaim = (id: string) => action(id, "/award/paid-claim");
export const awardPaidConfirm = (id: string) => action(id, "/award/paid-confirm");
export const rateBooking = (id: string, body: RatingInput) =>
  call<Rating>(bk(id, "/ratings"), { method: "POST", body });

/** Hex SHA-256 of a file, for the media presign contract. */
export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Uploads one evidence file for a booking: presign → PUT → finalize. Returns
 * the mediaId. `geo` is best-effort; the API stores "no location" when absent.
 */
export async function uploadBookingMedia(
  bookingId: string,
  phase: MediaPhase,
  slot: string,
  file: File,
  geo: Geo | null,
): Promise<string> {
  const mime = file.type as MediaMime;
  const { mediaId, uploadUrl } = await presignMedia(bookingId, {
    phase,
    slot,
    mime,
    bytes: file.size,
    sha256: await sha256Hex(file),
    geo,
  });
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": mime }, body: file });
  if (!put.ok) throw new ApiError(put.status, "Photo upload failed. Please try again.");
  await finalizeMedia(bookingId, mediaId);
  return mediaId;
}

/** Best-effort browser location; resolves null instead of rejecting. */
export function tryGeo(): Promise<Geo | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracyM: Math.round(p.coords.accuracy),
          capturedAt: new Date(p.timestamp).toISOString(),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}
