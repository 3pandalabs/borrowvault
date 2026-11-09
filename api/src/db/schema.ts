import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Schema per infra/blueprint.md §4, adapted to Phase 1 (no payment gateway):
//   - users carry email/password auth (RsvpVault scheme), phone, UPI VPA, trust
//   - `deposits` is replaced by `booking_payments` (UPI intent links, claim/confirm)
//   - invite_codes, dispute_messages, sessions, password_reset_tokens added
//
// Not expressible in Drizzle and therefore in a hand-written migration
// (drizzle/0001_bookings_no_overlap.sql): btree_gist + the bookings_no_overlap
// EXCLUDE constraint. Keep that file idempotent.

const ts = (n: string) => timestamp(n, { withTimezone: true });
const paise = (n: string) => bigint(n, { mode: "number" });

// ---------------------------------------------------------------------------
// Users & auth
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    phone: text("phone").notNull(),
    upiVpa: text("upi_vpa"),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    // Denormalised trust (blueprint §4 "Trust score"), recomputed after every
    // COMPLETED/RESOLVED booking and every rating. Read by every listing card.
    trustScore: doublePrecision("trust_score").notNull().default(4),
    trustCompleted: integer("trust_completed").notNull().default(0),
    trustDisputesLost: integer("trust_disputes_lost").notNull().default(0),
    // Chat push notifications on/off (PATCH /me chatPushEnabled). Default on.
    chatPushEnabled: boolean("chat_push_enabled").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("users_phone").on(t.phone)],
);

// Expo push tokens (POST/DELETE /me/push-tokens). One row per device token;
// a token that moves to another account is reassigned (upsert on token).
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique("push_tokens_token_unique"),
    platform: text("platform").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    index("push_tokens_user").on(t.userId),
    check("push_tokens_platform", sql`${t.platform} in ('ios', 'android')`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_sessions_user").on(t.userId)],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_password_reset_user").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Societies, towers, units, memberships, invite codes
// ---------------------------------------------------------------------------

export const societies = pgTable("societies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  centerLat: doublePrecision("center_lat").notNull(),
  centerLng: doublePrecision("center_lng").notNull(),
  radiusM: integer("radius_m").notNull().default(300),
  status: text("status").notNull().default("onboarding"), // onboarding | live | suspended
  // { depositMode?: "declared" | "p2p" }
  settings: jsonb("settings").$type<{ depositMode?: "declared" | "p2p" }>().notNull().default({}),
  // pilot: self-serve society with limits (lib/pilot.ts, ROUTES.md "Pilot societies")
  // until a platform admin marks it verified. Pre-existing rows are verified.
  tier: text("tier", { enum: ["pilot", "verified"] }).notNull().default("verified"),
  verifiedAt: ts("verified_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [check("societies_tier", sql`${t.tier} in ('pilot', 'verified')`)]);

export const towers = pgTable(
  "towers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    societyId: uuid("society_id")
      .notNull()
      .references(() => societies.id),
    name: text("name").notNull(),
  },
  (t) => [unique("towers_society_name").on(t.societyId, t.name)],
);

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    towerId: uuid("tower_id")
      .notNull()
      .references(() => towers.id),
    flatNo: text("flat_no").notNull(),
  },
  (t) => [unique("units_tower_flat").on(t.towerId, t.flatNo)],
);

export const membershipRole = pgEnum("membership_role", ["resident", "society_admin"]);
export const membershipStatus = pgEnum("membership_status", ["pending", "approved", "rejected", "revoked"]);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    societyId: uuid("society_id")
      .notNull()
      .references(() => societies.id),
    unitId: uuid("unit_id").references(() => units.id),
    role: membershipRole("role").notNull().default("resident"),
    status: membershipStatus("status").notNull().default("pending"),
    occupancy: text("occupancy").notNull(), // owner | tenant | family
    via: text("via").notNull().default("request"), // request | invite | platform
    inviteCodeId: uuid("invite_code_id"), // which invite code was used (usedCount)
    proofKey: text("proof_key"),
    reviewNote: text("review_note"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: ts("approved_at"),
    // When this membership became society_admin (null for residents). Set by an
    // approved admin request or POST /platform/societies; cleared on revoke-admin.
    adminSince: ts("admin_since"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_user_society").on(t.userId, t.societyId),
    index("memberships_society_status").on(t.societyId, t.status),
    index("memberships_unit").on(t.unitId),
  ],
);

export const inviteCodes = pgTable(
  "invite_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    societyId: uuid("society_id")
      .notNull()
      .references(() => societies.id),
    towerId: uuid("tower_id")
      .notNull()
      .references(() => towers.id),
    code: text("code").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("invite_codes_society").on(t.societyId)],
);

// Admin requests: nobody becomes society_admin without one of these carrying
// their own ID proof (admin-docs/ keys). See api/ROUTES.md "Admin requests".
//   new_society:    register a society (starts as a pilot) + make the requester its admin
//   join_admin:     promote the requester in a society they're an approved member of
//   nominate_admin: a society admin nominates a resident (requester = the nominee);
//                   auto-approved 48 h after the nominee uploads ID (lib/nominations.ts)
// kind/status are text + CHECK (pg enums until 0006): a new enum value can't
// be used in the transaction that adds it, and drizzle runs every pending
// migration in one transaction.
export const ADMIN_REQUEST_KINDS = ["new_society", "join_admin", "nominate_admin"] as const;
export const ADMIN_REQUEST_STATUSES = ["nominated", "pending", "approved", "rejected", "withdrawn", "declined", "cancelled"] as const;
export type AdminRequestKind = (typeof ADMIN_REQUEST_KINDS)[number];
export type AdminRequestStatus = (typeof ADMIN_REQUEST_STATUSES)[number];

export const adminRequests = pgTable(
  "admin_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ADMIN_REQUEST_KINDS }).notNull(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id),
    // join_admin / nominate_admin: required. new_society: filled on approval with the new society.
    societyId: uuid("society_id").references(() => societies.id),
    // Proposed society (new_society only)
    societyName: text("society_name"),
    city: text("city"),
    address: text("address"),
    centerLat: doublePrecision("center_lat"),
    centerLng: doublePrecision("center_lng"),
    radiusM: integer("radius_m"),
    towerName: text("tower_name"),
    flatNo: text("flat_no"),
    occupancy: text("occupancy"), // owner | tenant | family (same values as memberships.occupancy)
    committeeRole: text("committee_role").notNull(),
    statement: text("statement"),
    // Documents: admin-docs/<requesterId>/... keys, the requester's own uploads.
    // rwa_registration_key / authorization_key are legacy (no longer accepted);
    // kept nullable so older rows stay readable.
    rwaRegistrationKey: text("rwa_registration_key"),
    authorizationKey: text("authorization_key"),
    // Required on every request except a nomination the nominee hasn't accepted.
    idProofKey: text("id_proof_key"),
    residenceProofKey: text("residence_proof_key"), // new_society
    // nominate_admin only
    nominatedBy: uuid("nominated_by").references(() => users.id),
    nomineeAcceptedAt: ts("nominee_accepted_at"),
    autoApproveAt: ts("auto_approve_at"),
    status: text("status", { enum: ADMIN_REQUEST_STATUSES }).notNull().default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => users.id), // null on an automatic decision
    reviewedAt: ts("reviewed_at"),
    reviewNote: text("review_note"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("admin_requests_status_created").on(t.status, t.createdAt),
    index("admin_requests_requester").on(t.requesterId, t.createdAt),
    index("admin_requests_society").on(t.societyId, t.createdAt),
    // The auto-approve sweep: pending nominations whose 48 h are up.
    index("admin_requests_auto_approve").on(t.autoApproveAt).where(sql`status = 'pending' and auto_approve_at is not null`),
    // One pending request per (requester, kind, society). society_id is NULL on
    // a pending new_society request, so that kind gets its own index.
    uniqueIndex("admin_requests_one_pending_join")
      .on(t.requesterId, t.societyId)
      .where(sql`status = 'pending' and kind = 'join_admin'`),
    uniqueIndex("admin_requests_one_pending_new")
      .on(t.requesterId)
      .where(sql`status = 'pending' and kind = 'new_society'`),
    // One open nomination per (nominee, society).
    uniqueIndex("admin_requests_one_open_nomination")
      .on(t.requesterId, t.societyId)
      .where(sql`status in ('nominated', 'pending') and kind = 'nominate_admin'`),
    check("admin_requests_kind", sql`${t.kind} in ('new_society', 'join_admin', 'nominate_admin')`),
    check(
      "admin_requests_status",
      sql`${t.status} in ('nominated', 'pending', 'approved', 'rejected', 'withdrawn', 'declined', 'cancelled')`,
    ),
    check(
      "admin_requests_shape_v2",
      sql`(${t.kind} in ('join_admin', 'nominate_admin') and ${t.societyId} is not null) or (${t.kind} = 'new_society' and ${t.societyName} is not null and ${t.city} is not null and ${t.address} is not null and ${t.centerLat} is not null and ${t.centerLng} is not null and ${t.radiusM} is not null and ${t.towerName} is not null and ${t.flatNo} is not null and ${t.occupancy} in ('owner', 'tenant', 'family'))`,
    ),
    check("admin_requests_nominator", sql`(${t.kind} = 'nominate_admin') = (${t.nominatedBy} is not null)`),
    check(
      "admin_requests_id_proof",
      sql`${t.idProofKey} is not null or (${t.kind} = 'nominate_admin' and ${t.status} in ('nominated', 'declined', 'cancelled'))`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

export const listingKind = pgEnum("listing_kind", ["item", "skill"]);

export type ChecklistItem = {
  id: string;
  label: string;
  type: "bool" | "percent" | "choice" | "count" | "text";
  options?: string[];
};

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    societyId: uuid("society_id")
      .notNull()
      .references(() => societies.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    kind: listingKind("kind").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    hourlyPaise: paise("hourly_paise"),
    dailyPaise: paise("daily_paise"),
    weekendPaise: paise("weekend_paise"),
    depositPaise: paise("deposit_paise").notNull().default(0),
    replacementValuePaise: paise("replacement_value_paise"),
    checklistTemplate: jsonb("checklist_template").$type<ChecklistItem[]>().notNull().default([]),
    requiredPhotoSlots: jsonb("required_photo_slots").$type<string[]>().notNull().default([]),
    photoKeys: jsonb("photo_keys").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("active"), // active | paused | archived
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("listings_society_cat").on(t.societyId, t.category, t.status),
    index("listings_owner").on(t.ownerId),
    check("listing_has_price", sql`coalesce(${t.hourlyPaise}, ${t.dailyPaise}, ${t.weekendPaise}) is not null`),
    check(
      "deposit_le_replacement",
      sql`${t.replacementValuePaise} is null or ${t.depositPaise} <= ${t.replacementValuePaise}`,
    ),
    check("deposit_nonneg", sql`${t.depositPaise} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Bookings + append-only event log
// ---------------------------------------------------------------------------

// Same list as booking/states.ts BOOKING_STATES (test/states.test.ts asserts it).
// Inlined because drizzle-kit can't resolve a .js-suffixed TS import.
export const bookingState = pgEnum("booking_state", [
  "REQUESTED",
  "ACCEPTED",
  "DEPOSIT_HELD",
  "HANDOVER_PENDING",
  "ACTIVE",
  "OVERDUE",
  "RETURN_PENDING",
  "COMPLETED",
  "DISPUTED",
  "RESOLVED",
  "DECLINED",
  "EXPIRED",
  "CANCELLED",
]);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    societyId: uuid("society_id")
      .notNull()
      .references(() => societies.id),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    lenderId: uuid("lender_id")
      .notNull()
      .references(() => users.id),
    borrowerId: uuid("borrower_id")
      .notNull()
      .references(() => users.id),
    // Written ONLY by booking/transition.ts (and the initial insert).
    state: bookingState("state").notNull().default("REQUESTED"),
    stateChangedAt: ts("state_changed_at").notNull().defaultNow(),
    version: integer("version").notNull().default(0),
    pricing: text("pricing").notNull(), // hourly | daily | weekend
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    feePaise: paise("fee_paise").notNull(),
    depositPaise: paise("deposit_paise").notNull(),
    // Snapshot at creation: dispute claim caps use this, never the live listing.
    replacementValuePaise: paise("replacement_value_paise"),
    platformFeePaise: paise("platform_fee_paise").notNull().default(0),
    checklistSnapshot: jsonb("checklist_snapshot").$type<ChecklistItem[]>().notNull(),
    photoSlotsSnapshot: jsonb("photo_slots_snapshot").$type<string[]>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("bookings_listing_time").on(t.listingId, t.startsAt, t.endsAt),
    index("bookings_lender").on(t.lenderId, t.state),
    index("bookings_borrower").on(t.borrowerId, t.state),
    check("no_self_borrow", sql`${t.lenderId} <> ${t.borrowerId}`),
    check("time_order", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
// bookings_no_overlap EXCLUDE constraint: see drizzle/0001_bookings_no_overlap.sql

export const bookingEvents = pgTable(
  "booking_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    fromState: bookingState("from_state"),
    toState: bookingState("to_state").notNull(),
    actorId: uuid("actor_id"), // null = system / timer
    reason: text("reason").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("booking_events_booking").on(t.bookingId, t.id)],
);

// ---------------------------------------------------------------------------
// Inspections + write-once evidence
// ---------------------------------------------------------------------------

export const inspectionPhase = pgEnum("inspection_phase", ["handover", "return"]);
export const mediaPhase = pgEnum("media_phase", ["handover", "return", "dispute"]);
export const party = pgEnum("party", ["lender", "borrower"]);

export type ChecklistAnswer = { ok?: boolean; value?: string | number; note?: string };

export const inspections = pgTable(
  "inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    phase: inspectionPhase("phase").notNull(),
    party: party("party").notNull(),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id),
    checklistAnswers: jsonb("checklist_answers").$type<Record<string, ChecklistAnswer>>().notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    accuracyM: doublePrecision("accuracy_m"),
    withinGeofence: boolean("within_geofence").notNull(),
    clientCapturedAt: ts("client_captured_at").notNull(),
    submittedAt: ts("submitted_at").notNull().defaultNow(),
    // Counter-party acknowledgement of THIS submission
    ackBy: uuid("ack_by").references(() => users.id),
    ackResult: text("ack_result"), // agreed | objected
    ackNote: text("ack_note"),
    ackAt: ts("ack_at"),
  },
  (t) => [uniqueIndex("inspections_one_per_party").on(t.bookingId, t.phase, t.party)],
);

export const inspectionMedia = pgTable(
  "inspection_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inspectionId: uuid("inspection_id").references(() => inspections.id),
    disputeId: uuid("dispute_id"),
    // Objection evidence attached to a counter-party ack (slot "objection").
    ackInspectionId: uuid("ack_inspection_id"),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id),
    phase: mediaPhase("phase").notNull(),
    slot: text("slot").notNull(),
    // Presigned upload target. The client could PUT here again until the URL
    // expires, so it is NEVER served: finalize copies it to finalKey.
    r2Key: text("r2_key").notNull().unique(),
    // Immutable copy (evidence-final/...) that no presigned URL ever targets.
    // Hash is verified on THIS object; only this key is served.
    finalKey: text("final_key").unique(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    sha256Client: text("sha256_client").notNull(),
    sha256Server: text("sha256_server"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    accuracyM: doublePrecision("accuracy_m"),
    withinGeofence: boolean("within_geofence"),
    clientCapturedAt: ts("client_captured_at").notNull(),
    // Client clock disagrees with server receipt by > 10 min (flag, not a block).
    clockSkewFlag: boolean("clock_skew_flag"),
    receivedAt: ts("received_at"),
    status: text("status").notNull().default("presigned"), // presigned | verified | rejected
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("inspection_media_booking").on(t.bookingId)],
);

// ---------------------------------------------------------------------------
// Phase 1 payments (replaces blueprint `deposits`): UPI intent links straight
// to the lender, claim → confirm. The platform never holds money.
// ---------------------------------------------------------------------------

export const depositMode = pgEnum("deposit_mode", ["declared", "p2p"]);
export const depositStatus = pgEnum("deposit_status", [
  "none", // no deposit on this booking
  "pending", // accepted, lender hasn't confirmed receipt yet
  "declared", // declared mode: guaranteed by trust, no money moved
  "held_by_lender", // p2p: borrower paid the deposit to the lender
  "refund_claimed", // p2p: lender says refunded
  "refunded", // p2p: borrower confirmed refund
  "released", // declared: booking finished, nothing owed
]);
export const awardStatus = pgEnum("award_status", [
  "none",
  "debt_recorded", // payer owes payee via UPI
  "settled_from_deposit", // p2p: lender kept the award out of the deposit they hold
  "paid_claimed",
  "paid",
]);

export const bookingPayments = pgTable(
  "booking_payments",
  {
    bookingId: uuid("booking_id")
      .primaryKey()
      .references(() => bookings.id),
    depositMode: depositMode("deposit_mode").notNull(),
    feePaise: paise("fee_paise").notNull(),
    depositPaise: paise("deposit_paise").notNull(),
    // fee (+ p2p deposit) claim → confirm
    claimedAt: ts("claimed_at"),
    utr: text("utr"),
    confirmedAt: ts("confirmed_at"),
    depositStatus: depositStatus("deposit_status").notNull().default("pending"),
    // p2p refund back to the borrower
    refundDuePaise: paise("refund_due_paise").notNull().default(0),
    refundClaimedAt: ts("refund_claimed_at"),
    refundConfirmedAt: ts("refund_confirmed_at"),
    // dispute award
    awardPaise: paise("award_paise").notNull().default(0), // total award
    // p2p: the part of the award the lender kept out of the deposit they hold;
    // the rest (awardPaise - awardFromDepositPaise) is a UPI debt.
    awardFromDepositPaise: paise("award_from_deposit_paise").notNull().default(0),
    awardPayerId: uuid("award_payer_id").references(() => users.id),
    awardPayeeId: uuid("award_payee_id").references(() => users.id),
    awardStatus: awardStatus("award_status").notNull().default("none"),
    awardClaimedAt: ts("award_claimed_at"),
    awardConfirmedAt: ts("award_confirmed_at"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("payment_amounts_nonneg", sql`${t.feePaise} >= 0 and ${t.depositPaise} >= 0 and ${t.awardPaise} >= 0`),
    // A cancel after payment refunds the fee too, so the bound is fee + deposit.
    check("refund_le_paid", sql`${t.refundDuePaise} <= ${t.feePaise} + ${t.depositPaise}`),
  ],
);

// ---------------------------------------------------------------------------
// Disputes, messages, ratings
// ---------------------------------------------------------------------------

export const disputeStatus = pgEnum("dispute_status", [
  "open",
  "awaiting_response",
  "under_review",
  "escalated",
  "resolved",
  "withdrawn",
]);

export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .unique()
      .references(() => bookings.id),
    raisedBy: uuid("raised_by")
      .notNull()
      .references(() => users.id),
    // true when the system raised it on someone's behalf (p2p refund timeout)
    raisedBySystem: boolean("raised_by_system").notNull().default(false),
    category: text("category").notNull(), // damage | missing_part | not_returned | not_as_described | late
    description: text("description").notNull(),
    claimedPaise: paise("claimed_paise").notNull(),
    responseText: text("response_text"),
    responseOfferPaise: paise("response_offer_paise"),
    respondedAt: ts("responded_at"),
    status: disputeStatus("status").notNull().default("awaiting_response"),
    escalatedAt: ts("escalated_at"),
    arbiterId: uuid("arbiter_id").references(() => users.id),
    awardPaise: paise("award_paise"),
    rulingNote: text("ruling_note"),
    resolvedAt: ts("resolved_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [check("claim_nonneg", sql`${t.claimedPaise} >= 0`)],
);

// Optional thread on a dispute (both parties + arbiter). Not in the Phase 1
// route contract yet; the respond/ruling texts are mirrored here so the
// timeline is complete when a chat UI lands.
export const disputeMessages = pgTable(
  "dispute_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    disputeId: uuid("dispute_id")
      .notNull()
      .references(() => disputes.id),
    authorId: uuid("author_id").references(() => users.id), // null = system
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("dispute_messages_dispute").on(t.disputeId, t.createdAt)],
);

export const ratings = pgTable(
  "ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    raterId: uuid("rater_id")
      .notNull()
      .references(() => users.id),
    rateeId: uuid("ratee_id")
      .notNull()
      .references(() => users.id),
    stars: smallint("stars").notNull(),
    punctual: boolean("punctual"),
    careful: boolean("careful"),
    asDescribed: boolean("as_described"),
    comment: text("comment"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ratings_one_per_side").on(t.bookingId, t.raterId),
    index("ratings_ratee").on(t.rateeId),
    check("stars_range", sql`${t.stars} between 1 and 5`),
  ],
);

// ---------------------------------------------------------------------------
// Chat: one conversation per (listing, borrower), lender = listing owner.
// Messages are immutable (dispute evidence): no route edits or deletes one, and
// a trigger in drizzle/0004_chat.sql rejects UPDATE/DELETE on `messages`.
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    societyId: uuid("society_id")
      .notNull()
      .references(() => societies.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    borrowerId: uuid("borrower_id")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastMessageAt: ts("last_message_at"),
    // Unread tracking: each side's last read messages.seq (0 = nothing read).
    ownerLastReadSeq: bigint("owner_last_read_seq", { mode: "number" }).notNull().default(0),
    borrowerLastReadSeq: bigint("borrower_last_read_seq", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    uniqueIndex("conversations_listing_borrower").on(t.listingId, t.borrowerId),
    index("conversations_owner_activity").on(t.ownerId, t.lastMessageAt),
    index("conversations_borrower_activity").on(t.borrowerId, t.lastMessageAt),
    check("conversations_distinct_parties", sql`${t.ownerId} <> ${t.borrowerId}`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Total order for cursors/unread. Sends lock the conversation row before
    // inserting, so within a conversation seq order = commit order and a
    // poller using `after=` never skips a message.
    seq: bigint("seq", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("messages_seq").on(t.seq),
    index("messages_conversation_seq").on(t.conversationId, t.seq),
    check("messages_body_len", sql`char_length(${t.body}) between 1 and 2000`),
  ],
);

export const messageReports = pgTable(
  "message_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    societyId: uuid("society_id")
      .notNull()
      .references(() => societies.id),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("open"), // open | reviewed
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: ts("reviewed_at"),
    reviewNote: text("review_note"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("message_reports_one_per_reporter").on(t.messageId, t.reporterId),
    index("message_reports_society_status").on(t.societyId, t.status, t.createdAt),
    check("message_reports_status", sql`${t.status} in ('open', 'reviewed')`),
  ],
);
