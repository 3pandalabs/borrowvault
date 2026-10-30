import * as SecureStore from "expo-secure-store";
import type {
  AuthResponse,
  Booking,
  BookingDetail,
  BusyRange,
  CategoryPreset,
  ChecklistAnswer,
  DisputeCategory,
  Geo,
  Inspection,
  InspectionPhase,
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
  SocietySearchResult,
  Tower,
  User,
} from "./types";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

if (!API_URL) {
  throw new Error("Missing EXPO_PUBLIC_API_URL - check .env.local");
}

const ACCESS_TOKEN_KEY = "borrowvault_access_token";
const REFRESH_TOKEN_KEY = "borrowvault_refresh_token";

// Tokens live in SecureStore (not AsyncStorage): a leaked refresh token lets
// someone sign evidence and confirm payments as you.
let accessToken: string | null = null;
let refreshToken: string | null = null;
let hydrated = false;

async function hydrate() {
  if (hydrated) return;
  [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  hydrated = true;
}

async function persistTokens(tokens: { accessToken: string; refreshToken: string }) {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  hydrated = true;
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

async function clearTokens() {
  accessToken = null;
  refreshToken = null;
  hydrated = true;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}

/** Fired when a refresh fails so the auth context can drop to the sign-in screen. */
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(fn: (() => void) | null) {
  onSessionExpired = fn;
}

export class ApiError extends Error {
  status: number;
  /** `error` string from the `{error, code?}` body. */
  error: string;
  /** Optional machine code, e.g. TRANSITION_CONFLICT, OVERLAP, ALREADY_SUBMITTED. */
  code: string | null;
  constructor(status: number, error: string, code: string | null) {
    super(error);
    this.status = status;
    this.error = error;
    this.code = code;
  }
}

/** True for failures that are worth retrying (offline, timeouts, 5xx, 429). */
export function isTransient(err: unknown): boolean {
  if (err instanceof ApiError) return err.status >= 500 || err.status === 429 || err.status === 408;
  return true; // fetch threw: network down, DNS, TLS, aborted
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Set false for the auth endpoints themselves, which never send/expect a bearer token. */
  auth?: boolean;
};

const TIMEOUT_MS = 20_000;

async function rawRequest(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth !== false && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API_URL}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

let refreshInFlight: Promise<boolean> | null = null;

/** Refresh tokens rotate, so concurrent 401s must share one refresh call. */
function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      await hydrate();
      if (!refreshToken) return false;
      let res: Response;
      try {
        res = await rawRequest("/auth/refresh", {
          method: "POST",
          body: { refreshToken },
          auth: false,
        });
      } catch {
        return false; // offline: keep tokens, let the caller surface the error
      }
      if (!res.ok) {
        if (res.status === 401 || res.status === 400) {
          await clearTokens();
          onSessionExpired?.();
        }
        return false;
      }
      await persistTokens((await res.json()) as AuthResponse);
      return true;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Every 401 on an authenticated request gets exactly one refresh-and-retry. */
async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  await hydrate();
  let res = await rawRequest(path, opts);

  if (res.status === 401 && opts.auth !== false) {
    if (await refreshAccessToken()) {
      res = await rawRequest(path, opts);
    }
  }

  if (!res.ok) {
    let error = "request_failed";
    let code: string | null = null;
    try {
      const data = (await res.json()) as { error?: string; code?: string };
      if (data?.error) error = data.error;
      if (data?.code) code = data.code;
    } catch {
      // body wasn't JSON - keep the generic error
    }
    throw new ApiError(res.status, error, code);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ?? {} });
const patch = <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body });

function qs(params: Record<string, string | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

const b = (id: string) => `/bookings/${encodeURIComponent(id)}`;

// ---------------- Auth ----------------

export async function signup(input: {
  email: string;
  password: string;
  displayName: string;
  phone: string;
}): Promise<User> {
  const data = await request<AuthResponse>("/auth/signup", { method: "POST", body: input, auth: false });
  await persistTokens(data);
  return data.user;
}

export async function login(email: string, password: string): Promise<User> {
  const data = await request<AuthResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    auth: false,
  });
  await persistTokens(data);
  return data.user;
}

export async function logout(): Promise<void> {
  await hydrate();
  if (refreshToken) {
    try {
      // ROUTES.md: POST /auth/logout is authenticated, body {refreshToken} → 204.
      await request("/auth/logout", { method: "POST", body: { refreshToken } });
    } catch {
      // best-effort server-side revoke; local tokens are cleared regardless
    }
  }
  await clearTokens();
}

export async function hasSession(): Promise<boolean> {
  await hydrate();
  return !!(accessToken || refreshToken);
}

export const requestPasswordReset = (email: string) =>
  request<void>("/auth/password-reset/request", { method: "POST", body: { email }, auth: false });

// ---------------- Profile ----------------

export const getMe = () => get<Me>("/me");
export const updateMe = (body: { displayName?: string; phone?: string; upiVpa?: string }) =>
  patch<{ user: User }>("/me", body);

// ---------------- Societies ----------------

export const searchSocieties = (q: string) =>
  request<SocietySearchResult[]>(`/societies${qs({ q })}`, { auth: false });
export const getTowers = (societyId: string) =>
  request<Tower[]>(`/societies/${encodeURIComponent(societyId)}/towers`, { auth: false });
export const joinSociety = (
  societyId: string,
  body: { inviteCode?: string; towerId: string; flatNo: string; occupancy: Occupancy; proofKey?: string },
) => post<Membership>(`/societies/${encodeURIComponent(societyId)}/join`, body);

// ---------------- Storage ----------------

export const presignStorage = (body: { purpose: PresignPurpose; mime: string; bytes: number }) =>
  post<{ key: string; uploadUrl: string }>("/storage/presign", body);
export const getStorageUrl = (key: string) => get<{ url: string }>(`/storage/url${qs({ key })}`);

// ---------------- Listings ----------------

export const getCategories = () => get<CategoryPreset[]>("/categories");
/** `ownerId: "me"` lists my listings across all my societies. */
export const listListings = (p: { societyId?: string; ownerId?: "me"; kind?: ListingKind; category?: string; q?: string }) =>
  get<ListingSummary[]>(`/listings${qs(p)}`);
export const getListing = (id: string) => get<Listing>(`/listings/${encodeURIComponent(id)}`);
export const createListing = (body: ListingInput) => post<Listing>("/listings", body);
export const updateListing = (id: string, body: ListingPatch) =>
  patch<Listing>(`/listings/${encodeURIComponent(id)}`, body);
export const getAvailability = (id: string, from: string, to: string) =>
  get<BusyRange[]>(`/listings/${encodeURIComponent(id)}/availability${qs({ from, to })}`);

// ---------------- Bookings ----------------

export const createBooking = (body: { listingId: string; startsAt: string; endsAt: string; pricing: PricingUnit }) =>
  post<Booking>("/bookings", body);
export const listBookings = (p: { role?: "lender" | "borrower"; state?: string }) =>
  get<Booking[]>(`/bookings${qs(p)}`);
export const getBooking = (id: string) => get<BookingDetail>(b(id));

// Every booking action returns the fresh BookingDetail (ROUTES.md response convention).
const act = (id: string, path: string, body?: unknown) => post<BookingDetail>(`${b(id)}/${path}`, body);

export const acceptBooking = (id: string) => act(id, "accept");
export const declineBooking = (id: string) => act(id, "decline");
export const cancelBooking = (id: string) => act(id, "cancel");
export const claimPayment = (id: string, utr?: string) => act(id, "payment/claim", utr ? { utr } : {});
export const confirmPayment = (id: string) => act(id, "payment/confirm");

/** `geo: null` = no fix; stored as "no location", never rejected. */
export const presignMedia = (
  id: string,
  body: { phase: MediaPhase; slot: string; mime: MediaMime; bytes: number; sha256: string; geo: Geo | null },
) => post<{ mediaId: string; uploadUrl: string }>(`${b(id)}/media/presign`, body);
export const finalizeMedia = (id: string, mediaId: string) =>
  post<{ ok: true }>(`${b(id)}/media/${encodeURIComponent(mediaId)}/finalize`);

export const submitInspection = (
  id: string,
  body: {
    phase: InspectionPhase;
    mediaIds: string[];
    checklistAnswers: Record<string, ChecklistAnswer>;
    geo: Geo | null;
  },
) => post<Inspection>(`${b(id)}/inspections`, body);
/** `mediaIds` (≤5): the acker's own finalized `objection`-slot uploads for that phase. */
export const ackInspection = (
  id: string,
  body: { phase: InspectionPhase; result: "agreed" | "objected"; note?: string; mediaIds?: string[] },
) => act(id, "inspections/ack", body);

export const raiseDispute = (
  id: string,
  body: { category: DisputeCategory; description: string; claimedPaise: number; mediaIds?: string[] },
) => act(id, "disputes", body);
export const respondDispute = (id: string, body: { responseText: string; offerPaise?: number }) =>
  act(id, "disputes/respond", body);
export const acceptDisputeOffer = (id: string) => act(id, "disputes/accept-offer");

export const depositRefundClaim = (id: string) => act(id, "deposit/refund-claim");
export const depositRefundConfirm = (id: string) => act(id, "deposit/refund-confirm");
/** Award payer = `payment.awardPayerId`; payee = `payment.awardPayeeId`. */
export const awardPaidClaim = (id: string) => act(id, "award/paid-claim");
export const awardPaidConfirm = (id: string) => act(id, "award/paid-confirm");

export const rateBooking = (id: string, body: RatingInput) => post<Rating>(`${b(id)}/ratings`, body);

// ---------------- Error copy ----------------

export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "OVERLAP":
        return "Those dates are already booked. Please pick another slot.";
      case "TRANSITION_CONFLICT":
      case "CONFLICT":
        return "This booking has moved on in the meantime. Pull down to refresh.";
      case "ALREADY_SUBMITTED":
        return "You've already submitted this.";
      case "UNAVAILABLE":
        return "Bookings are briefly unavailable. Please try again in a minute.";
      case "VALIDATION":
      case "FORBIDDEN":
        // Domain errors carry a human-readable `error`.
        return err.error;
      case "NOT_FOUND":
        return "Not found, or not in your society.";
    }
    switch (err.error) {
      case "invalid_credentials":
        return "Incorrect email or password.";
      case "email_taken":
        return "An account with this email already exists.";
      case "rate_limited":
        return "Too many attempts. Please wait a minute and try again.";
    }
    if (err.status === 404) return "Not found, or not in your society.";
    if (err.status === 403) return "You're not allowed to do that on this booking.";
    if (err.status === 503) return "Bookings are briefly unavailable. Please try again in a minute.";
    if (err.status >= 500) return "Server error. Please try again in a moment.";
    return err.error.replace(/_/g, " ");
  }
  return "Couldn't reach BorrowVault. Check your connection and try again.";
}

/** POST /bookings → 403 while the user owes an award or has trust < 2.0. */
export function bookingRequestError(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) {
    const detail = err.code === "FORBIDDEN" && err.error ? ` (${err.error})` : "";
    return `You can't borrow right now: settle any unpaid dispute award first, or ask your society admin to review your account if your trust score is below 2.0.${detail}`;
  }
  return friendlyError(err);
}
