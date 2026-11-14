"use client";

// Typed client for api/ROUTES.md. The whole web app is client-rendered and
// talks to the API straight from the browser (same as RsvpVault's dashboard):
// no server-side fetch means no orange-to-orange problem, and the API's bearer
// check stays the only authorization boundary.

import type {
  AdminDispute,
  AdminMembership,
  AdminRequest,
  AdminRequestInput,
  AdminRequestStatus,
  ApproveAdminRequestInput,
  AuthResponse,
  Booking,
  BlockedUser,
  BookingDetail,
  BookingState,
  BusyRange,
  DeletionBlocker,
  DeletionCheck,
  ListingReport,
  ListingReportReason,
  ReportFilter,
  ReportReceipt,
  UserReport,
  UserReportReason,
  CategoryPreset,
  ChecklistAnswer,
  Conversation,
  ConversationSummary,
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
  Message,
  MessagePage,
  MessageReport,
  MessageReportReceipt,
  MessageReportStatus,
  Occupancy,
  PresignPurpose,
  PlatformAdminRequest,
  PricingUnit,
  Rating,
  RatingInput,
  Society,
  SocietyAdmin,
  SocietyPatch,
  SocietySearchResult,
  Tower,
  UnreadCounts,
  User,
} from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    /** The full error body, for routes that add fields (e.g. `blockers` on POST /me/delete). */
    readonly body?: Record<string, unknown> | null,
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
    if (Object.prototype.hasOwnProperty.call(MESSAGE_COPY, e.message)) return MESSAGE_COPY[e.message];
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

// Admin-request and admin-membership errors (api/ROUTES.md) put a code in
// `error` rather than prose, so they get human copy here.
const MESSAGE_COPY: Record<string, string> = {
  // Signup with a registered email (generic on purpose: no account-enumeration oracle).
  registration_failed: "Couldn't create an account with this email. If you've signed up before, sign in instead.",
  request_pending:
    "There is already an open admin request or nomination for this person and society. Wait for it, or withdraw it from My requests.",
  already_admin: "That person is already an admin of this society.",
  not_pending: "This request has already been reviewed, withdrawn or cancelled. Refresh to see where it is now.",
  membership_not_active:
    "The membership in this society is no longer approved, so this person can't be made an admin.",
  // Pilot societies and co-admin nominations (ROUTES.md).
  society_full:
    "This pilot society is full. Pilot societies can have up to 50 members, admins included, until BorrowVault verifies them.",
  pilot_value_cap: "In a pilot society, the deposit and replacement value can be at most ₹5,000 each.",
  pilot_platform_rules:
    "In a pilot society, the BorrowVault team rules disputes. Society admins can't rule until the society is verified.",
  already_verified: "This society is already verified.",
  not_nominated: "This nomination is no longer waiting for your answer. Refresh to see where it is now.",
  nominee_not_approved: "Only approved residents can be nominated. Approve their membership first.",
  cannot_nominate_self: "You can't nominate yourself.",
  nominator_not_admin: "The admin who made this nomination is no longer an admin of this society.",
  not_admin: "That person isn't an admin of this society any more. Refresh the list.",
  admin_membership_platform_only:
    "Only BorrowVault can reject or remove a society admin. Write to 3PandaLabs if an admin should step down.",
  platform_admin_required: "Only BorrowVault platform admins can do that.",
  // Chat (ROUTES.md "Chat").
  message_empty: "Type a message first.",
  message_too_long: "That message is too long. Keep it to 2,000 characters.",
  conversation_closed: "This chat is read-only now, so new messages can't be sent. You can still read everything in it.",
  participants_only: "Only the lender and borrower can do that. Admins can read this chat but not post in it.",
  cannot_message_own_listing: "This is your own listing. Neighbours who want to borrow it can message you.",
  cannot_report_own_message: "You can only report the other person's messages.",
  already_reported: "You've already reported this. Your society admin will look at it.",
  // Blocking, reporting, takedown and account deletion (ROUTES.md).
  blocked: "You can't do that. One of you has blocked the other.",
  cannot_block_self: "You can't block yourself.",
  cannot_report_self: "You can't report yourself.",
  cannot_report_own_listing: "This is your own listing.",
  listing_removed: "A society admin removed this listing. It can't be edited or put back up.",
  wrong_password: "That password is wrong. Try again.",
  account_has_open_obligations: "Finish the bookings listed below first. Then you can delete your account.",
  account_deleted: "This account has been deleted.",
  invalid_cursor: "This chat changed while you were looking. Refresh the page.",
  rate_limited: "You're doing that too often. Wait a minute and try again.",
};

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
  const body = (await res.json().catch(() => null)) as ({ error?: string; code?: string } & Record<string, unknown>) | null;
  return new ApiError(res.status, body?.error ?? "request_failed", body?.code, body);
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
/** Read-only for society admins; only platform admins can remove one. */
export const societyAdmins = (societyId: string) =>
  call<SocietyAdmin[]>(`/admin/societies/${enc(societyId)}/admins`);

// ---- admin requests (becoming a society admin) ----

/** → 201 AdminRequest (pending). 409 `request_pending`/`already_admin`; join_admin 404 = no approved membership. */
export const createAdminRequest = (b: AdminRequestInput) =>
  call<AdminRequest>("/admin-requests", { method: "POST", body: b });
/** Newest first, all statuses. */
export const myAdminRequests = () => call<AdminRequest[]>("/admin-requests/mine");
/** 409 `not_pending` if it isn't pending any more. */
export const withdrawAdminRequest = (id: string) =>
  call<AdminRequest>(`/admin-requests/${enc(id)}/withdraw`, { method: "POST" });
/** Nominee: upload ID proof (admin_doc) → pending, auto-approves 48 h later. 409 `not_nominated`. */
export const acceptNomination = (id: string, b: { idProofKey: string; statement?: string }) =>
  call<AdminRequest>(`/admin-requests/${enc(id)}/accept`, { method: "POST", body: b });
/** Nominee says no. 409 `not_nominated`. */
export const declineNomination = (id: string) =>
  call<AdminRequest>(`/admin-requests/${enc(id)}/decline`, { method: "POST" });
/** Nominator cancels while nominated/pending. 409 `not_pending`. */
export const cancelNomination = (id: string) =>
  call<AdminRequest>(`/admin-requests/${enc(id)}/cancel`, { method: "POST" });

// ---- co-admin nominations (society admin) ----

/** → 201 AdminRequest (nominate_admin, status `nominated`). */
export const nominateCoAdmin = (societyId: string, b: { membershipId: string; committeeRole?: string }) =>
  call<AdminRequest>(`/admin/societies/${enc(societyId)}/nominations`, { method: "POST", body: b });
/** This society's nominations, newest first. */
export const societyNominations = (societyId: string) =>
  call<AdminRequest[]>(`/admin/societies/${enc(societyId)}/nominations`);

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
/** Pilot → verified (lifts the pilot limits). 409 `already_verified`. */
export const verifySociety = (societyId: string) =>
  call<Society>(`/platform/societies/${enc(societyId)}/verify`, { method: "POST" });
/** Default `pending` (oldest first); other statuses newest first. docUrls last 10 min. */
export const listPlatformAdminRequests = (status?: AdminRequestStatus) =>
  call<PlatformAdminRequest[]>(`/platform/admin-requests${qs({ status })}`);
export const approveAdminRequest = (id: string, b: ApproveAdminRequestInput) =>
  call<PlatformAdminRequest>(`/platform/admin-requests/${enc(id)}/approve`, { method: "POST", body: b });
/** `note` is required (5–1000) and emailed to the requester. */
export const rejectAdminRequest = (id: string, note: string) =>
  call<PlatformAdminRequest>(`/platform/admin-requests/${enc(id)}/reject`, { method: "POST", body: { note } });
export const platformSocietyAdmins = (societyId: string) =>
  call<SocietyAdmin[]>(`/platform/societies/${enc(societyId)}/admins`);
/** Demotes to resident (stays approved). `note` required (5–1000). → the remaining admins. */
export const revokeSocietyAdmin = (societyId: string, membershipId: string, note: string) =>
  call<SocietyAdmin[]>(`/platform/societies/${enc(societyId)}/admins/${enc(membershipId)}/revoke-admin`, {
    method: "POST",
    body: { note },
  });

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

// ---- chat (lender ↔ borrower) ----
// Delivery is polling: GET /conversations/:id/messages?after=<newest id> every
// ~5 s while a chat is open, and /conversations/unread for badges.

/** 200 existing / 201 new; 403 `cannot_message_own_listing` for the owner. */
export const openListingConversation = (listingId: string) =>
  call<Conversation>("/conversations", { method: "POST", body: { listingId } });
/** Booking parties only (admins use BookingDetail.conversationId). */
export const openBookingConversation = (bookingId: string) =>
  call<Conversation>(bk(bookingId, "/conversation"), { method: "POST" });
export const listConversations = () => call<ConversationSummary[]>("/conversations");
export const getUnread = () => call<UnreadCounts>("/conversations/unread");
export const getConversation = (id: string) => call<Conversation>(`/conversations/${enc(id)}`);
/** Always oldest first, in server order (never re-sort). Reading doesn't mark anything read. */
export const getMessages = (id: string, p: { after?: string; before?: string; limit?: number } = {}) =>
  call<MessagePage>(
    `/conversations/${enc(id)}/messages${qs({ after: p.after, before: p.before, limit: p.limit ? String(p.limit) : undefined })}`,
  );
export const sendMessage = (id: string, body: string) =>
  call<Message>(`/conversations/${enc(id)}/messages`, { method: "POST", body: { body } });
/** → 204. Always a JSON body: `{}` = everything read (an empty JSON body is a 400). */
export const markConversationRead = (id: string, upToMessageId?: string) =>
  call<void>(`/conversations/${enc(id)}/read`, { method: "POST", body: upToMessageId ? { upToMessageId } : {} });
/** Only the other participant's messages; once per message. */
export const reportMessage = (messageId: string, reason: string) =>
  call<MessageReportReceipt>(`/messages/${enc(messageId)}/report`, { method: "POST", body: { reason } });

// ---- account deletion ----

/** Preflight: what still blocks deletion. */
export const getDeletionCheck = () => call<DeletionCheck>("/me/deletion");
/** → 204. 403 `wrong_password`; 409 `account_has_open_obligations` with `blockers` (see deletionBlockers). */
export const deleteAccount = (password: string) => call<void>("/me/delete", { method: "POST", body: { password } });
/** The `blockers` a 409 from POST /me/delete carries, or null. */
export function deletionBlockers(e: unknown): DeletionBlocker[] | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const b = e.body?.blockers;
  return Array.isArray(b) ? (b as DeletionBlocker[]) : null;
}

// ---- blocking and reporting ----

export const blockUser = (userId: string) => call<BlockedUser>(`/users/${enc(userId)}/block`, { method: "POST" });
export const unblockUser = (userId: string) => call<void>(`/users/${enc(userId)}/block`, { method: "DELETE" });
export const myBlocks = () => call<BlockedUser[]>("/me/blocks");
export const reportUser = (userId: string, b: { reason: UserReportReason; details?: string }) =>
  call<ReportReceipt>(`/users/${enc(userId)}/report`, { method: "POST", body: b });
export const reportListing = (listingId: string, b: { reason: ListingReportReason; details?: string }) =>
  call<ReportReceipt>(`/listings/${enc(listingId)}/report`, { method: "POST", body: b });

export const adminUserReports = (societyId: string, status: ReportFilter = "open") =>
  call<UserReport[]>(`/admin/societies/${enc(societyId)}/user-reports${qs({ status })}`);
export const reviewUserReport = (id: string, b: { decision: "reviewed" | "dismissed"; note?: string }) =>
  call<UserReport>(`/admin/user-reports/${enc(id)}/review`, { method: "POST", body: b });
export const adminListingReports = (societyId: string, status: ReportFilter = "open") =>
  call<ListingReport[]>(`/admin/societies/${enc(societyId)}/listing-reports${qs({ status })}`);
export const dismissListingReport = (id: string, note?: string) =>
  call<ListingReport>(`/admin/listing-reports/${enc(id)}/dismiss`, { method: "POST", body: note ? { note } : {} });
/** Admin takedown: status `removed`, note 5–1000 (shown to the owner). */
export const removeListing = (listingId: string, note: string) =>
  call<Listing>(`/admin/listings/${enc(listingId)}/remove`, { method: "POST", body: { note } });

export const adminMessageReports = (societyId: string, status: MessageReportStatus = "open") =>
  call<MessageReport[]>(`/admin/societies/${enc(societyId)}/message-reports${qs({ status })}`);
export const reviewMessageReport = (id: string, note?: string) =>
  call<MessageReport>(`/admin/message-reports/${enc(id)}/review`, { method: "POST", body: note ? { note } : {} });
