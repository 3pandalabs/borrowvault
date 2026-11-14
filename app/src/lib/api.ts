import * as SecureStore from "expo-secure-store";
import type {
  AdminMembership,
  AdminRequest,
  AuthResponse,
  BlockedUser,
  Booking,
  BookingDetail,
  BusyRange,
  CategoryPreset,
  ChecklistAnswer,
  Conversation,
  ConversationSummary,
  DeletionCheck,
  DisputeCategory,
  Geo,
  Inspection,
  InspectionPhase,
  Listing,
  ListingInput,
  ListingKind,
  ListingPatch,
  ListingReportReason,
  ListingSummary,
  Me,
  MediaMime,
  MediaPhase,
  Membership,
  MembershipStatus,
  Message,
  MessagePage,
  MessageReportReceipt,
  Occupancy,
  PresignPurpose,
  PricingUnit,
  Rating,
  RatingInput,
  ReportReceipt,
  SocietySearchResult,
  Tower,
  UnreadCounts,
  User,
  UserReportReason,
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
export const updateMe = (body: { displayName?: string; phone?: string; upiVpa?: string; chatPushEnabled?: boolean }) =>
  patch<{ user: User }>("/me", body);

// ---------------- Account deletion ----------------

/** Preflight: what must be finished before the account can be deleted. */
export const getDeletionCheck = () => get<DeletionCheck>("/me/deletion");
/** 204. 403 wrong_password; 409 account_has_open_obligations (re-check with getDeletionCheck). */
export const deleteAccount = (password: string) => post<void>("/me/delete", { password });

// ---------------- Blocking & reporting users ----------------

const u = (id: string) => `/users/${encodeURIComponent(id)}`;
export const blockUser = (id: string) => post<BlockedUser>(`${u(id)}/block`);
export const unblockUser = (id: string) => request<void>(`${u(id)}/block`, { method: "DELETE" });
export const listBlocks = () => get<BlockedUser[]>("/me/blocks");
export const reportUser = (id: string, reason: UserReportReason, details?: string) =>
  post<ReportReceipt>(`${u(id)}/report`, details ? { reason, details } : { reason });

/** Copy for block/report errors (the shared friendlyError reads 409 as a booking conflict). */
export function safetyError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.error) {
      case "already_reported":
        return "You already reported this. An admin will look at it.";
      case "cannot_block_self":
        return "You can't block yourself.";
      case "cannot_report_self":
        return "You can't report yourself.";
      case "cannot_report_own_listing":
        return "This is your own listing.";
      case "rate_limited":
        return "You're going too fast. Please wait a moment and try again.";
    }
    if (err.status === 404) return "This person or listing isn't available any more.";
  }
  return friendlyError(err);
}

// ---------------- Push tokens ----------------

export const registerPushToken = (token: string, platform: "ios" | "android") =>
  post<void>("/me/push-tokens", { token, platform });
export const deletePushToken = (token: string) =>
  request<void>("/me/push-tokens", { method: "DELETE", body: { token } });

// ---------------- Societies ----------------

export const searchSocieties = (q: string) =>
  request<SocietySearchResult[]>(`/societies${qs({ q })}`, { auth: false });
export const getTowers = (societyId: string) =>
  request<Tower[]>(`/societies/${encodeURIComponent(societyId)}/towers`, { auth: false });
export const joinSociety = (
  societyId: string,
  body: { inviteCode?: string; towerId: string; flatNo: string; occupancy: Occupancy; proofKey?: string },
) => post<Membership>(`/societies/${encodeURIComponent(societyId)}/join`, body);

// ---------------- Admin requests ----------------
// Submitting one needs document uploads, which happen on the web (src/lib/web.ts).

export const listMyAdminRequests = () => get<AdminRequest[]>("/admin-requests/mine");
export const withdrawAdminRequest = (id: string) =>
  post<AdminRequest>(`/admin-requests/${encodeURIComponent(id)}/withdraw`);
/** Nominee declines a co-admin nomination (accepting needs an ID upload, which is on the web). */
export const declineNomination = (id: string) =>
  post<AdminRequest>(`/admin-requests/${encodeURIComponent(id)}/decline`);

/** Admin-request errors whose generic copy (written for bookings) would mislead. */
export function adminRequestError(err: unknown): string {
  if (err instanceof ApiError && err.error === "not_pending") {
    return "This request has already been reviewed or withdrawn. Pull down to refresh.";
  }
  if (err instanceof ApiError && err.error === "not_nominated") {
    return "This nomination has already been answered or cancelled. Pull down to refresh.";
  }
  if (err instanceof ApiError && err.status === 404) return "Request not found. Pull down to refresh.";
  return friendlyError(err);
}

// ---------------- Society admin: join requests ----------------

export const listSocietyMemberships = (societyId: string, status?: MembershipStatus) =>
  get<AdminMembership[]>(`/admin/societies/${encodeURIComponent(societyId)}/memberships${qs({ status })}`);
export const approveMembership = (id: string, note?: string) =>
  post<Membership>(`/admin/memberships/${encodeURIComponent(id)}/approve`, note ? { note } : {});
export const rejectMembership = (id: string, note?: string) =>
  post<Membership>(`/admin/memberships/${encodeURIComponent(id)}/reject`, note ? { note } : {});

/** Approve/decline errors whose generic copy (written for bookings) would mislead. */
export function membershipReviewError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.error === "society_full")
      return "Your pilot society is at its 50-member limit. BorrowVault lifts it once your society is verified.";
    if (err.error === "admin_membership_platform_only") return "Only BorrowVault can decline a society admin.";
    if (err.code === "CONFLICT") return "Someone already reviewed this request. Pull down to refresh.";
    if (err.status === 404) return "This request isn't there any more. Pull down to refresh.";
  }
  return friendlyError(err);
}

// ---------------- Storage ----------------

export const presignStorage = (body: { purpose: PresignPurpose; mime: string; bytes: number }) =>
  post<{ key: string; uploadUrl: string }>("/storage/presign", body);
export const getStorageUrl = (key: string) => get<{ url: string }>(`/storage/url${qs({ key })}`);

// ---------------- Listings ----------------

export const getCategories = () => get<CategoryPreset[]>("/categories");
/** `ownerId: "me"` lists my listings across all my societies. */
export const listListings = (p: { societyId?: string; ownerId?: "me"; kind?: ListingKind; category?: string; q?: string; free?: "1" }) =>
  get<ListingSummary[]>(`/listings${qs(p)}`);
export const getListing = (id: string) => get<Listing>(`/listings/${encodeURIComponent(id)}`);
export const createListing = (body: ListingInput) => post<Listing>("/listings", body);
export const updateListing = (id: string, body: ListingPatch) =>
  patch<Listing>(`/listings/${encodeURIComponent(id)}`, body);
export const reportListing = (id: string, reason: ListingReportReason, details?: string) =>
  post<ReportReceipt>(`/listings/${encodeURIComponent(id)}/report`, details ? { reason, details } : { reason });
export const getAvailability = (id: string, from: string, to: string) =>
  get<BusyRange[]>(`/listings/${encodeURIComponent(id)}/availability${qs({ from, to })}`);

// ---------------- Bookings ----------------

export const createBooking = (body: { listingId: string; startsAt: string; endsAt: string; pricing?: PricingUnit }) =>
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

// ---------------- Chat ----------------

const conv = (id: string) => `/conversations/${encodeURIComponent(id)}`;

/** 200 existing / 201 new; 403 cannot_message_own_listing for the owner. */
export const createConversation = (listingId: string) => post<Conversation>("/conversations", { listingId });
/** Either booking party; works in any booking state. */
export const bookingConversation = (bookingId: string) => post<Conversation>(`${b(bookingId)}/conversation`);
export const listConversations = () => get<ConversationSummary[]>("/conversations");
export const getConversation = (id: string) => get<Conversation>(conv(id));
/** `messages` is always oldest first. `after` = poll for newer, `before` = page back; never both. */
export const listMessages = (id: string, p: { after?: string; before?: string; limit?: number } = {}) =>
  get<MessagePage>(`${conv(id)}/messages${qs({ after: p.after, before: p.before, limit: p.limit?.toString() })}`);
export const sendMessage = (id: string, body: string) => post<Message>(`${conv(id)}/messages`, { body });
/** Always sends a JSON object (`{}` = up to the latest): an empty JSON body is a 400. */
export const markRead = (id: string, upToMessageId?: string) =>
  post<void>(`${conv(id)}/read`, upToMessageId ? { upToMessageId } : {});
export const unreadCounts = () => get<UnreadCounts>("/conversations/unread");
export const reportMessage = (messageId: string, reason: string) =>
  post<MessageReportReceipt>(`/messages/${encodeURIComponent(messageId)}/report`, { reason });

/** Chat error copy. The shared friendlyError reads any 409 as "this booking has moved on", which is wrong here. */
export function chatError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.error) {
      case "message_empty":
        return "Type a message first.";
      case "message_too_long":
        return "Messages can be at most 2,000 characters.";
      case "blocked":
        return "You can't message each other because one of you blocked the other.";
      case "conversation_closed":
        return "This chat is read-only now, so you can't send new messages.";
      case "cannot_message_own_listing":
        return "This is your own listing.";
      case "cannot_report_own_message":
        return "You can only report the other person's messages.";
      case "already_reported":
        return "You've already reported this message. Your society admin will look at it.";
      case "participants_only":
        return "Only the lender and the borrower can do that in this chat.";
      case "rate_limited":
        return "You're going too fast. Please wait a moment and try again.";
      case "invalid_cursor":
        return "This chat changed. Pull down to reload.";
    }
    if (err.status === 404) return "Chat not found, or you're no longer in this society.";
    if (err.status === 409) return "This chat changed in the meantime. Please try again.";
    if (err.status === 403) return "You're not allowed to do that in this chat.";
  }
  return friendlyError(err);
}

// ---------------- Error copy ----------------

export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.error === "listing_removed") return "A society admin removed this listing. It can't be changed or put back.";
    if (err.error === "wrong_password") return "That password isn't right.";
    // Signup with a registered email: 409 CONFLICT, which the code switch below would read as a booking race.
    if (err.error === "registration_failed")
      return "Couldn't create an account with this email. If you've signed up before, sign in instead.";
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
    if (err.status === 429) return "Too many attempts. Please wait a minute and try again.";
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
  if (err instanceof ApiError && err.error === "blocked") {
    return "You can't book from this person because one of you blocked the other.";
  }
  if (err instanceof ApiError && err.status === 403) {
    const detail = err.code === "FORBIDDEN" && err.error ? ` (${err.error})` : "";
    return `You can't borrow right now: settle any unpaid dispute award first, or ask your society admin to review your account if your trust score is below 2.0.${detail}`;
  }
  return friendlyError(err);
}
