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
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("users_phone").on(t.phone)],
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
  createdAt: ts("created_at").notNull().defaultNow(),
});

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
