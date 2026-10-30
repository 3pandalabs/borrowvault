// Types mirror api/ROUTES.md (the final Phase 1 contract) exactly.

export type Trust = { score: number; completed: number; disputesLost: number };

export type User = {
  id: string;
  email: string;
  displayName: string;
  phone: string;
  upiVpa: string | null;
  isPlatformAdmin: boolean;
  trust: Trust;
};

export type AuthResponse = { accessToken: string; refreshToken: string; user: User };

export type MembershipStatus = "pending" | "approved" | "rejected" | "revoked";
export type Occupancy = "owner" | "tenant" | "family";

export type Membership = {
  id: string;
  societyId: string;
  societyName: string;
  towerName: string;
  flatNo: string;
  role: "resident" | "society_admin";
  status: MembershipStatus;
  occupancy: Occupancy;
  createdAt: string;
};

export type Me = { user: User; memberships: Membership[] };

export type SocietySearchResult = { id: string; name: string; city: string };
export type Tower = { id: string; name: string };

export type AdminMembership = Membership & {
  user: { id: string; displayName: string; email: string; phone: string };
  proofKey: string | null;
};

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
};

export type SocietyPatch = {
  centerLat?: number;
  centerLng?: number;
  radiusM?: number;
  settings?: { depositMode?: DepositMode };
};

export type InviteCode = { code: string; towerId: string; towerName: string; expiresAt: string; usedCount: number };

export type PresignPurpose = "proof" | "listing_photo";

export type PartyInfo = {
  id: string;
  displayName: string;
  towerName: string;
  flatNo: string;
  trust: Trust;
};

// ---- Listings ----

export type ListingKind = "item" | "skill";
export type ListingStatus = "active" | "paused" | "archived";
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

export type ListingPatch = Partial<Omit<ListingInput, "societyId">> & { status?: ListingStatus };

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

export type Listing = ListingSummary & {
  description: string;
  replacementValuePaise: number | null;
  checklistTemplate: ChecklistItem[];
  requiredPhotoSlots: string[];
  photoKeys: string[];
  /** Presigned GETs (10 min), same order as photoKeys. */
  photoUrls: string[];
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
export type MediaMime = "image/jpeg" | "image/png" | "video/mp4" | "video/quicktime";
export type Geo = { lat: number; lng: number; accuracyM: number; capturedAt: string };

export type ChecklistAnswer = { ok?: boolean; value?: string | number; note?: string };

export type Media = {
  id: string;
  slot: string;
  url: string;
  mime: string;
  receivedAt: string;
  withinGeofence: boolean;
  noLocation: boolean;
  clockSkewFlag: boolean;
};

export type Inspection = {
  id: string;
  phase: InspectionPhase;
  party: "lender" | "borrower";
  checklistAnswers: Record<string, ChecklistAnswer>;
  withinGeofence: boolean;
  noLocation: boolean;
  submittedAt: string;
  media: Media[];
  ack: { result: "agreed" | "objected"; note: string | null; at: string; media: Media[] } | null;
};

export type DisputeCategory = "damage" | "missing_part" | "not_returned" | "not_as_described" | "late";
export type DisputeStatus = "open" | "awaiting_response" | "under_review" | "escalated" | "resolved" | "withdrawn";

export type Dispute = {
  id: string;
  /** A user id, or "system" for the auto-raised p2p refund dispute. */
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
  /** Only in BookingDetail. */
  media?: Media[];
};

export type AdminDispute = Dispute & { booking: Booking };

export type BookingEvent = { fromState: BookingState | null; toState: BookingState; reason: string | null; at: string };

export type BookingDetail = Booking & {
  society: { id: string; name: string; centerLat: number; centerLng: number; radiusM: number };
  checklistSnapshot: ChecklistItem[];
  photoSlotsSnapshot: string[];
  payment: Payment | null;
  inspections: Inspection[];
  dispute: Dispute | null;
  events: BookingEvent[];
};

export type RatingInput = {
  stars: number;
  punctual?: boolean;
  careful?: boolean;
  asDescribed?: boolean;
  comment?: string;
};

export type Rating = {
  id: string;
  bookingId: string;
  rateeId: string;
  stars: number;
  punctual: boolean | null;
  careful: boolean | null;
  asDescribed: boolean | null;
  comment: string | null;
  createdAt: string;
};
