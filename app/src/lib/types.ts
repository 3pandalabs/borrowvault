// Types mirror api/ROUTES.md (the final Phase 1 contract) exactly.

export type Trust = { score: number; completed: number; disputesLost: number };

export type User = {
  id: string;
  email: string;
  displayName: string;
  phone: string;
  upiVpa: string | null;
  isPlatformAdmin: boolean;
  /** Chat push notifications on (default) or off (PATCH /me). */
  chatPushEnabled: boolean;
  trust: Trust;
};

export type AuthResponse = { accessToken: string; refreshToken: string; user: User };

export type MembershipStatus = "pending" | "approved" | "rejected" | "revoked";
export type Occupancy = "owner" | "tenant" | "family";

export type Membership = {
  id: string;
  societyId: string;
  societyName: string;
  /** pilot = new self-serve society with limits until BorrowVault verifies it. */
  societyTier: SocietyTier;
  towerName: string;
  flatNo: string;
  role: "resident" | "society_admin";
  status: MembershipStatus;
  occupancy: Occupancy;
  createdAt: string;
};

export type Me = { user: User; memberships: Membership[] };

export type SocietyTier = "pilot" | "verified";

/** `full` = a pilot society at its member cap (joining fails with 409 `society_full`). */
export type SocietySearchResult = { id: string; name: string; city: string; tier: SocietyTier; full: boolean };
export type Tower = { id: string; name: string };

export type DepositMode = "declared" | "p2p";

export type Society = {
  id: string;
  name: string;
  city: string;
  centerLat: number;
  centerLng: number;
  radiusM: number;
  settings: { depositMode: DepositMode };
  status: string;
  tier: SocietyTier;
  verifiedAt: string | null;
  memberCount: number;
  createdAt: string;
};

export type PresignPurpose = "proof" | "listing_photo" | "admin_doc";

// ---- Admin requests (becoming a society admin; submitted on the web) ----

export type AdminRequestKind = "new_society" | "join_admin" | "nominate_admin";
export type AdminRequestStatus =
  | "nominated"
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "declined"
  | "cancelled";

export type AdminRequest = {
  id: string;
  kind: AdminRequestKind;
  status: AdminRequestStatus;
  requesterId: string;
  /** join_admin: always set. new_society: null until approved, then the new society's id. */
  societyId: string | null;
  /** join_admin: the society's name. new_society: the proposed name. */
  societyName: string;
  /** new_society only, as submitted (approval overrides aren't reflected here). */
  proposedSociety: {
    name: string;
    city: string;
    address: string;
    centerLat: number;
    centerLng: number;
    radiusM: number;
    towerName: string;
    flatNo: string;
    occupancy: Occupancy;
  } | null;
  committeeRole: string;
  statement: string | null;
  docs: {
    idProofKey: string | null;
    residenceProofKey: string | null;
    rwaRegistrationKey: string | null;
    authorizationKey: string | null;
  };
  /** nominate_admin only. */
  nominatedBy: { id: string; displayName: string } | null;
  nomineeAcceptedAt: string | null;
  autoApproveAt: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ---- Listings ----

export type ListingKind = "item" | "skill";
export type ListingStatus = "active" | "paused" | "archived" | "removed";
/** Statuses an owner can set with PATCH (an admin sets "removed"). */
export type OwnerListingStatus = "active" | "paused" | "archived";
export type ChecklistType = "bool" | "percent" | "choice" | "count" | "text";

/** `id` matches ^[a-z0-9_]{1,40}$; `choice` needs ≥2 options. */
export type ChecklistItem = {
  id: string;
  label: string;
  type: ChecklistType;
  options?: string[];
};

export type CategoryPreset = {
  key: string;
  label: string;
  kind: ListingKind;
  checklistTemplate: ChecklistItem[];
  requiredPhotoSlots: string[];
};

export type ListingInput = {
  societyId: string;
  kind: ListingKind;
  category: string;
  title: string;
  description: string;
  hourlyPaise?: number;
  dailyPaise?: number;
  weekendPaise?: number;
  depositPaise: number;
  replacementValuePaise?: number;
  checklistTemplate: ChecklistItem[];
  requiredPhotoSlots: string[];
  photoKeys: string[];
};

export type ListingPatch = Partial<Omit<ListingInput, "societyId">> & { status?: OwnerListingStatus };

export type PartyInfo = {
  id: string;
  displayName: string;
  towerName: string;
  flatNo: string;
  trust: Trust;
};

export type ListingSummary = {
  id: string;
  societyId: string;
  kind: ListingKind;
  category: string;
  title: string;
  hourlyPaise: number | null;
  dailyPaise: number | null;
  weekendPaise: number | null;
  depositPaise: number;
  status: ListingStatus;
  coverUrl: string | null;
  owner: PartyInfo;
};

/** `photoUrls` are presigned GETs (10 min) in the same order as `photoKeys`. */
export type Listing = ListingSummary & {
  description: string;
  replacementValuePaise: number | null;
  checklistTemplate: ChecklistItem[];
  requiredPhotoSlots: string[];
  photoKeys: string[];
  photoUrls: string[];
  /** Set only when status is "removed" (only the owner sees a removed listing). */
  removal: { note: string; removedAt: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type BusyRange = { startsAt: string; endsAt: string };

// ---- Bookings ----

export type BookingState =
  | "REQUESTED"
  | "ACCEPTED"
  | "DEPOSIT_HELD"
  | "HANDOVER_PENDING"
  | "ACTIVE"
  | "OVERDUE"
  | "RETURN_PENDING"
  | "COMPLETED"
  | "DISPUTED"
  | "RESOLVED"
  | "DECLINED"
  | "EXPIRED"
  | "CANCELLED";

export type PricingUnit = "hourly" | "daily" | "weekend";

export type NextAction =
  | "accept_or_decline"
  | "wait_lender"
  | "pay"
  | "confirm_payment"
  | "wait_payment"
  | "handover_inspect"
  | "handover_ack"
  | "wait_handover"
  | "return_inspect"
  | "review_return"
  | "wait_review"
  | "respond_dispute"
  | "accept_offer"
  | "wait_ruling"
  | "refund_deposit"
  | "confirm_refund"
  | "pay_award"
  | "confirm_award"
  | "rate";

export type Booking = {
  id: string;
  state: BookingState;
  listing: { id: string; title: string; kind: ListingKind; category: string };
  lender: PartyInfo;
  borrower: PartyInfo;
  startsAt: string;
  endsAt: string;
  pricing: PricingUnit;
  feePaise: number;
  depositPaise: number;
  /** Snapshot taken at booking time; caps dispute claims. */
  replacementValuePaise: number | null;
  platformFeePaise: number;
  myRole: "lender" | "borrower" | "admin";
  nextAction: NextAction | null;
  deadlineAt: string | null;
};

export type DepositStatus = "none" | "pending" | "declared" | "held_by_lender" | "refund_claimed" | "refunded" | "released";
export type AwardStatus = "none" | "debt_recorded" | "settled_from_deposit" | "paid_claimed" | "paid";

/** `null` on the booking until the lender accepts. */
export type Payment = {
  depositMode: DepositMode;
  feePaise: number;
  depositPaise: number;
  feeUpiIntent: string;
  depositUpiIntent: string | null;
  refundUpiIntent: string | null;
  awardUpiIntent: string | null;
  claimedAt: string | null;
  confirmedAt: string | null;
  utr: string | null;
  depositStatus: DepositStatus;
  refundDuePaise: number | null;
  refundClaimedAt: string | null;
  refundConfirmedAt: string | null;
  awardPaise: number | null;
  awardFromDepositPaise: number | null;
  awardStatus: AwardStatus;
  awardPayerId: string | null;
  awardPayeeId: string | null;
};

export type InspectionPhase = "handover" | "return";
export type MediaPhase = InspectionPhase | "dispute";

export type ChecklistAnswer = { ok?: boolean; value?: string | number; note?: string };

export type Media = {
  id: string;
  slot: string;
  /** presigned GET, 10 min */
  url: string;
  mime: string;
  receivedAt: string;
  withinGeofence: boolean;
  noLocation: boolean;
  clockSkewFlag: boolean;
};

export type InspectionAck = { result: "agreed" | "objected"; note: string | null; at: string; media: Media[] };

export type Inspection = {
  id: string;
  phase: InspectionPhase;
  party: "lender" | "borrower";
  checklistAnswers: Record<string, ChecklistAnswer>;
  withinGeofence: boolean;
  noLocation: boolean;
  submittedAt: string;
  media: Media[];
  ack: InspectionAck | null;
};

export type DisputeCategory = "damage" | "missing_part" | "not_returned" | "not_as_described" | "late";
export type DisputeStatus = "open" | "awaiting_response" | "under_review" | "escalated" | "resolved" | "withdrawn";

export type Dispute = {
  id: string;
  /** user id, or "system" for the auto-raised p2p refund dispute */
  raisedBy: string;
  raisedBySystem: boolean;
  category: DisputeCategory;
  description: string;
  claimedPaise: number;
  responseText: string | null;
  offerPaise: number | null;
  status: DisputeStatus;
  awardPaise: number | null;
  rulingNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  escalatedAt: string | null;
  deadlineAt: string | null;
  /** dispute evidence (BookingDetail only) */
  media?: Media[];
};

export type BookingEvent = { fromState: BookingState | null; toState: BookingState; reason: string | null; at: string };

export type BookingSociety = { id: string; name: string; centerLat: number; centerLng: number; radiusM: number };

export type BookingDetail = Booking & {
  society: BookingSociety;
  checklistSnapshot: ChecklistItem[];
  photoSlotsSnapshot: string[];
  payment: Payment | null;
  inspections: Inspection[];
  dispute: Dispute | null;
  events: BookingEvent[];
  /** The lender↔borrower chat for this listing, or null if neither has opened it (ROUTES.md "Chat"). */
  conversationId: string | null;
};

export type RatingInput = {
  stars: number;
  punctual?: boolean;
  careful?: boolean;
  asDescribed?: boolean;
  comment?: string;
};

export type Rating = RatingInput & { id: string; bookingId: string; rateeId: string; createdAt: string };

// ---- Chat (lender ↔ borrower) ----

/** Messages are immutable and totally ordered by the server: never re-sort by `createdAt`. */
export type Message = { id: string; senderId: string; body: string; createdAt: string };

export type ConversationListing = { id: string; title: string; status: ListingStatus; coverUrl: string | null };

export type Conversation = {
  id: string;
  societyId: string;
  listing: ConversationListing;
  owner: PartyInfo;
  borrower: PartyInfo;
  myRole: "owner" | "borrower" | "admin";
  canSend: boolean;
  /** The caller has blocked the other participant (false for admins). */
  blockedByMe: boolean;
  /** For the caller; 0 for admins. */
  unreadCount: number;
  /** Newest live booking of this listing by this borrower. */
  activeBookingId: string | null;
  /** Every booking of this listing by this borrower, newest first. */
  bookings: { id: string; state: BookingState; startsAt: string; endsAt: string }[];
  createdAt: string;
  lastMessageAt: string | null;
};

export type ConversationSummary = {
  id: string;
  societyId: string;
  listing: ConversationListing;
  /** The other participant. */
  other: PartyInfo;
  myRole: "owner" | "borrower";
  /** `body` truncated to 140 chars (ends with "…" when cut). */
  lastMessage: Message | null;
  lastMessageAt: string | null;
  unreadCount: number;
  activeBookingId: string | null;
};

export type MessagePage = { messages: Message[]; hasMore: boolean };

export type UnreadCounts = { total: number; byConversation: Record<string, number> };

export type MessageReportReceipt = { id: string; messageId: string; status: "open"; createdAt: string };

// ---- Client-side helpers ----

export type SocietyGeofence = Pick<BookingSociety, "centerLat" | "centerLng" | "radiusM">;

export type Geo = { lat: number; lng: number; accuracyM: number; capturedAt: string };

/** Evidence MIME types the app captures (png is web-only for disputes). */
export type MediaMime = "image/jpeg" | "video/mp4" | "video/quicktime";

// ---- Account deletion, blocking, reports ----

export type DeletionBlockerKind = "live_booking" | "open_dispute" | "unpaid_award" | "refund_owed";
export type DeletionBlocker = { kind: DeletionBlockerKind; bookingId: string; listingTitle: string; state: BookingState };
export type DeletionCheck = { canDelete: boolean; blockers: DeletionBlocker[] };

export type BlockedUser = { user: { id: string; displayName: string }; createdAt: string };

export type UserReportReason = "harassment" | "spam" | "scam" | "inappropriate" | "other";
export type ListingReportReason = "prohibited_item" | "misleading" | "offensive" | "scam" | "other";
export type ReportReceipt = { id: string; status: "open"; createdAt: string };
