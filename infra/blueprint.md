# BorrowVault — Production Blueprint (v1)

Name **BorrowVault** (decided 2026-10-30; fits the RentVault / RsvpVault / AdVault family; rename is copy-only, per the org convention). Peer-to-peer item rental + micro-skills network, scoped to ONE gated society (500+ flats) at a time.

Date: 2026-10-30. Status: exploring. Built on the existing 3PandaLabs stack — nothing new is introduced except a payment gateway.

---

## 0. TL;DR decisions

| Area | Decision | Why |
|---|---|---|
| Mobile | **Expo (React Native) 57**, same as RentVault `app/` | Camera + GPS are mandatory for the inspection flow; already have EAS + keystore pipeline |
| Web | **Next.js 16 on Cloudflare Workers** (`@opennextjs/cloudflare`) | Society-admin console + public listing previews; same as RentVault/RsvpVault |
| API | **Fastify 5 + Drizzle + Zod + JWT** on Coolify (Hetzner `nrighar-coolify-fsn`) | Copy RsvpVault's `api/` skeleton (cleanest reference) |
| Orchestration | **Temporal** (already live on the box) — one long-running workflow per booking | The booking IS a state machine with timers (accept timeout, return due, auto-release, dispute SLA). Exactly what RentVault's Temporal setup is for |
| DB | New `borrowvault` database + `borrowvault_app` role on shared `3pandalabs-postgres` | Org pattern. **No PostGIS** — the society is the geofence; a centre point + radius (or a small polygon checked in app code) is enough |
| Media | R2 buckets `borrowvault-evidence` (private, presigned) + `borrowvault-backups` | Same as `nrighar-documents`. Evidence is never public |
| Email | Shared `3pandalabs/mailer` Worker | Org convention. Push via Expo Notifications for time-critical steps |
| Payments | **UPI only.** Phase 1: direct UPI intent links (lender's VPA, no gateway — RentVault `payLinks` pattern). Phase 2: **UPI one-time mandate / block** for the deposit (funds *blocked* in the borrower's bank, debited only on a damage award) + UPI collect for the fee, via Razorpay (Cashfree fallback) | UPI is how India pays; a block means no money moves on the happy path — nothing to refund |
| Hostnames | `borrowvault.3pandalabs.com`, `api.borrowvault.3pandalabs.com`, `api-internal.borrowvault.3pandalabs.com` | **All under one first label** (cert lesson from RsvpVault, 2026-10-26) |
| Ops | `/metrics` endpoint + admin page table; Mermaid flow diagram in `3pandalabs/admin` | Org conventions |

### ⚠️ Blocker to resolve before building payments

**Any UPI merchant integration — mandates, collect, payouts — goes through a payment aggregator (Razorpay / Cashfree / PhonePe PG), and they onboard Indian-registered businesses only** (Indian PAN, Indian current account, GST where applicable). 3PandaLabs is a **New Jersey LLC** — it cannot be the merchant of record. Plain person-to-person UPI intent links (`upi://pay?pa=<lender VPA>…`) need no merchant account at all, which is why Phase 1 uses them. Options:

1. **Phase 1 without a gateway (recommended MVP):** rental fee paid lender-direct via UPI intent link (exactly RentVault's `payLinks` pattern). Deposit is either *declared* (trust-score gating + society-admin accountability) or paid P2P to the lender via UPI with a tracked refund obligation (see §2.1). Validate demand first.
2. Incorporate an Indian Pvt Ltd (or LLP) subsidiary → Razorpay onboarding → turn on deposits in Phase 2.
3. Partner model: a society's RWA (often a registered society with PAN + bank account) becomes the merchant. Messy; not recommended.

Also: holding customer money for a marketplace is regulated by RBI's Payment Aggregator rules. Using **Razorpay Route** means Razorpay (a licensed PA) holds the funds in its nodal/escrow account and we only instruct holds/releases — **we never hold money ourselves.** Keep it that way.

---

## 1. System architecture

```
                       Cloudflare (proxied, orange cloud)
  ┌──────────────┐     ┌───────────────────────────┐
  │ Expo app     │────▶│ api.borrowvault.3pandalabs  │──┐
  │ (resident)   │     └───────────────────────────┘  │   Hetzner nrighar-coolify-fsn
  └──────────────┘                                    │   (Coolify + Traefik)
  ┌──────────────┐     ┌───────────────────────────┐  │  ┌──────────────────────────┐
  │ Browser      │────▶│ borrowvault-web Worker      │──┼─▶│ borrowvault-api (Fastify)  │
  │ (admin/web)  │     │ (Next.js 16, OpenNext)    │  │  │   routes → Temporal       │
  └──────────────┘     └───────────────────────────┘  │  ├──────────────────────────┤
                         server-side → api-internal ──┘  │ borrowvault-worker          │
                                                         │   workflows + activities  │
  Razorpay ──webhooks──▶ /webhooks/razorpay ────────────▶│   (Temporal task queue    │
                                                         │    "borrowvault")           │
                                                         ├──────────────────────────┤
                                                         │ temporal (shared)         │
                                                         │ 3pandalabs-postgres       │
                                                         │   db: borrowvault           │
                                                         └───────────┬──────────────┘
                                                                     │ presigned PUT/GET
                                                              Cloudflare R2
                                                    borrowvault-evidence / borrowvault-backups
```

Repo `3pandalabs/borrowvault` (public, per org convention): `web/` + `app/` + `api/` (+ `Dockerfile.worker`, as in nrighar) + `infra/` + `brand/`.

### 1.1 Why Temporal for the booking (and what stays outside it)

* **Postgres is the source of truth** for booking state. Every transition is a conditional `UPDATE … WHERE state = :expected` plus an append-only `booking_events` row, in one transaction. Temporal never "owns" state — it owns **time and retries**.
* One workflow per booking, ID `booking-<uuid>`. Routes **signal** it (accept, inspection submitted, dispute raised, admin ruling); UPI payment confirmations signal it (`paymentEvent` — from the Razorpay webhook in Phase 2, or the lender's "Received" tap in Phase 1).
* Durable timers do the work that cron jobs usually get wrong: lender doesn't respond in 12 h → `EXPIRED`; borrower doesn't pay in 30 min → `EXPIRED`; return time passes → `OVERDUE` + nudges; lender silent 24 h after return → auto-`COMPLETED` + deposit release; dispute unresolved 72 h → escalate to platform.
* Payment-gateway calls are **activities** with idempotency keys (`booking:<id>:award`, `booking:<id>:release`), so Temporal retries are safe.

### 1.2 Evidence integrity (the "digital proof" part)

What we can honestly guarantee, and how:

| Property | Mechanism |
|---|---|
| Photo taken *now*, not from gallery | Expo `CameraView` only; gallery picker disabled on inspection screens |
| Taken *inside the society* | `expo-location` high-accuracy fix at shutter time; server checks distance to society centre ≤ `radius_m + accuracy_m` (cap accuracy at 100 m). Out-of-fence = allowed but **flagged**, not blocked (basements kill GPS) |
| Timestamp can't be backdated | Server `received_at` is authoritative; client `captured_at` stored but only used to flag skew > 10 min |
| File not altered after upload | Client computes SHA-256 before upload; server re-hashes on finalize (R2 `HeadObject` + stream hash in activity); mismatch = rejected. Keys are write-once (`evidence/<bookingId>/<phase>/<party>/<uuid>.jpg`), no overwrite route exists |
| Both parties saw the same evidence | Each side's submission is **countersigned**: the other party taps "I agree this matches" (or raises an objection) → that acknowledgement is itself an event |
| Nothing is deleted during a dispute | R2 lifecycle: evidence retained 180 days after `COMPLETED`, indefinitely while a dispute is open (DPDP: purpose-limited retention, documented in privacy policy) |

Spoofed GPS on rooted Android is possible; we accept that. The *real* deterrent is the society context: everyone's flat number is known to the admin.

---

## 2. Payment / escrow strategy — UPI only

No cards, no wallets, no netbanking. Two phases, same `DepositProvider` interface so the booking code never changes.

### 2.1 Phase 1 — direct UPI intent links (no gateway, no Indian entity needed)

The app builds a standard UPI deep link and hands it to whatever UPI app the user has (GPay / PhonePe / Paytm / BHIM):

```
upi://pay?pa=<lender VPA>&pn=<lender name>&am=350.00&cu=INR&tn=LV-<booking short id> rental fee
```

* **Rental fee** → lender's VPA directly. Borrower taps "I've paid" (+ optional UTR / screenshot); lender taps "Received". Same claim-then-confirm flow as RentVault `payLinks` (`claim-paid`).
* **Deposit**, two options per society setting:
  * **Declared (default):** no money moves. The booking shows "₹3,000 deposit, guaranteed by trust score". A lost dispute → award becomes a debt shown on the borrower's profile, borrowing blocked until the lender confirms payment, society admin informed. Works because everyone's flat is known.
  * **P2P deposit:** borrower pays deposit to the lender's VPA with the fee. On `COMPLETED` the lender gets a UPI intent link back to the *borrower's* VPA and must tap "Refunded" within 24 h; borrower confirms. No refund in 24 h → auto-dispute, lender borrowing/lending frozen, admin paged.
* We **never touch money** in Phase 1 → no RBI PA question, no gateway fees, no KYC. Downside: the platform can't enforce refunds, only reputation.
* Booking states map: `DEPOSIT_HELD` = "both sides confirmed the fee (and P2P deposit, if on) was received".

### 2.2 Phase 2 — UPI block for the deposit (needs Indian entity + aggregator)

NPCI allows **UPI one-time mandates** ("block now, debit later"): the borrower approves once with their UPI PIN, the amount is **blocked in their own bank account** (they keep the interest, it's not debited), and the merchant can later debit **up to** the blocked amount once, or revoke it. Razorpay exposes this as *UPI One Time Mandate* (Cashfree has an equivalent). *Verify at onboarding: max block validity for our merchant category (published as up to 90 days at the time of writing), whether a partial debit of the block is allowed, and fees.*

```
ACCEPT   → create fee order (UPI collect/intent) + create deposit mandate (UPI block)
            borrower approves both in their UPI app (two PIN prompts, or one combined flow if the PG supports it)
FEE PAID → Route transfer of fee to lender's linked account, on_hold = true
BLOCK OK → DEPOSIT_HELD   (money still sitting in the borrower's bank, just frozen)

COMPLETED → revoke mandate (block released instantly, nothing to refund)
            release Route hold on fee → lender paid
DISPUTE   → keep block (validity timer must exceed rental + 24 h review + 72 h dispute SLA)
RULING    → execute mandate debit for award (≤ block), then revoke remainder;
            award routed to lender; fee hold released
CANCEL    → revoke mandate; refund fee per policy
```

Why this beats "capture then refund":

* **Happy path moves zero deposit money** — no refund delays, no "where is my refund" support tickets, no gateway fee on the deposit.
* Borrower trust: "your money never leaves your account unless the admin rules against you".
* Lender payout still held until the return handshake (Route on-hold).

Edge cases the design handles:

| Case | Handling |
|---|---|
| Rental longer than max block validity | Don't allow listing it with a deposit for that duration; or re-block (borrower re-approves) before expiry — Temporal timer fires a "renew deposit" step 48 h before expiry |
| Borrower's bank declines / insufficient balance for block | Booking stays `ACCEPTED`, 30-min payment timer expires it |
| Borrower revokes the mandate from their UPI app mid-rental | Webhook → booking flagged, lender + admin notified, trust-score penalty; treated like a missing deposit |
| Debit fails at ruling time (account closed) | Award recorded as debt (Phase-1 "declared" path), borrower blocked |
| Fallback if UPI block unavailable for our category | Capture deposit via UPI collect and refund on completion (Refunds API) — same interface, `mode = "capture_refund"` |

Lender onboarding for payouts = Razorpay Route **linked account** (lender PAN + bank account/VPA; Razorpay does that KYC, not us). Holding customer money for a marketplace is regulated under RBI's Payment Aggregator rules — Route keeps the money with the licensed PA; **we never hold it.**

Gateway abstraction (Phase 1 and Phase 2 both implement it):

```ts
interface DepositProvider {
  /** Fee collection + deposit block. Phase 1 returns UPI intent links instead of PG objects. */
  start(i: { bookingId: string; feePaise: number; depositPaise: number; platformFeePaise: number;
             lenderVpa: string; lenderAccountId?: string; blockValidUntil: Date }):
    Promise<{ feeOrderId: string; mandateId?: string; upiIntents: { fee: string; deposit?: string } }>;
  releaseDeposit(i: { bookingId: string; mandateId: string; idempotencyKey: string }): Promise<void>;     // revoke block
  debitDeposit(i: { bookingId: string; mandateId: string; amountPaise: number; idempotencyKey: string }):
    Promise<{ paymentId: string }>;                                                                     // execute ≤ block
  transferToLender(i: { paymentId: string; accountId: string; amountPaise: number; onHold: boolean;
                        idempotencyKey: string }): Promise<{ transferId: string }>;
  releaseTransferHold(transferId: string): Promise<void>;
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
}
```

Money is always **integer paise** (`bigint`), never floats/numeric-in-JS.

Fees (strawman, Phase 2 only): platform fee 8% of rental fee, min ₹10, collected inside the fee order. UPI P2M is zero-MDR for most merchant categories today, which keeps this cheap — *verify current MDR rules at onboarding*. Phase 1 is free.

---

## 3. Resident verification & onboarding

MyGate / NoBrokerHood **have no public resident-verification API** — integration is a partnership/BD conversation, not a Phase-1 dependency. Design the verification layer as pluggable `VerificationMethod`s:

| Method | Phase | Trust weight | Notes |
|---|---|---|---|
| **Society invite code per tower** (admin generates, posts on society WhatsApp/notice board) | 1 | low — gets you to `PENDING` only | Zero-friction growth loop |
| **Proof upload** (maintenance bill / rent agreement / allotment letter / electricity bill with flat no.) | 1 | medium | Reuse RentVault `lib/kyc/extract.ts` pattern: LLM extracts name + flat + society, auto-matches unit, admin one-taps approve |
| **Society Admin approval** | 1 | high — required for `APPROVED` | Admin sees unit occupancy (max N active memberships per unit) |
| **Phone OTP** | 1 | identity, not residency | Indian mobile numbers ≈ identity anchor. Use an SMS provider via Indian entity, or WhatsApp OTP |
| **Aadhaar offline XML** (free, UIDAI) | 2 | identity | Same plan as RentVault KYC memory; required to *lend* above ₹5k deposit value |
| **MyGate/NoBrokerHood deep link / partnership** | 3 | high | BD-dependent |

Roles (per society membership — a user can belong to 2 societies, e.g. owner + tenant elsewhere):

* `resident` — can borrow and lend (lender/borrower is per-booking, not a role)
* `society_admin` — approves residents, arbitrates disputes in their society, can't arbitrate a dispute they're party to
* `platform_admin` — 3PandaLabs ops; final escalation

A society goes live when it has ≥1 approved admin and a geofence (admin drops a pin + radius on a map; platform admin verifies once).

---

## 4. Data model (Drizzle / Postgres)

```
societies 1─* towers 1─* units 1─* memberships *─1 users
                                        │
users 1─* listings (owner) ─* bookings *─1 users (borrower)
                                 │
            ┌────────────┬───────┼──────────┬──────────────┬───────────┐
       booking_events  inspections  deposits      disputes        ratings
                           │                       │
                    inspection_media        dispute_evidence / dispute_messages
```

```ts
// api/src/db/schema.ts (excerpt — full file follows the nrighar/evitevault style)
import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, doublePrecision, index, integer, jsonb, pgEnum, pgTable,
  smallint, text, timestamp, unique, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  phoneE164: text("phone_e164").notNull().unique(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  displayName: text("display_name").notNull(),
  razorpayAccountId: text("razorpay_account_id"),          // Route linked account (lenders)
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const societies = pgTable("societies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  centerLat: doublePrecision("center_lat").notNull(),
  centerLng: doublePrecision("center_lng").notNull(),
  radiusM: integer("radius_m").notNull().default(300),
  status: text("status").notNull().default("onboarding"),   // onboarding | live | suspended
  settings: jsonb("settings").notNull().default({}),        // max deposit, allowed categories, etc.
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const towers = pgTable("towers", {
  id: uuid("id").primaryKey().defaultRandom(),
  societyId: uuid("society_id").notNull().references(() => societies.id),
  name: text("name").notNull(),
}, (t) => [unique().on(t.societyId, t.name)]);

export const units = pgTable("units", {
  id: uuid("id").primaryKey().defaultRandom(),
  towerId: uuid("tower_id").notNull().references(() => towers.id),
  flatNo: text("flat_no").notNull(),
}, (t) => [unique().on(t.towerId, t.flatNo)]);

export const membershipRole = pgEnum("membership_role", ["resident", "society_admin"]);
export const membershipStatus = pgEnum("membership_status", ["pending", "approved", "rejected", "revoked"]);

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  societyId: uuid("society_id").notNull().references(() => societies.id),
  unitId: uuid("unit_id").references(() => units.id),
  role: membershipRole("role").notNull().default("resident"),
  status: membershipStatus("status").notNull().default("pending"),
  occupancy: text("occupancy").notNull(),                   // owner | tenant | family
  proofKey: text("proof_key"),                              // R2 key, private
  proofExtract: jsonb("proof_extract"),                     // LLM extraction result
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: ts("approved_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("memberships_user_society").on(t.userId, t.societyId)]);

export const listingKind = pgEnum("listing_kind", ["item", "skill"]);

export const listings = pgTable("listings", {
  id: uuid("id").primaryKey().defaultRandom(),
  societyId: uuid("society_id").notNull().references(() => societies.id),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  kind: listingKind("kind").notNull(),
  category: text("category").notNull(),                     // power_tools | camera | camping | baby | party | baking | tutoring ...
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  hourlyPaise: bigint("hourly_paise", { mode: "number" }),
  dailyPaise: bigint("daily_paise", { mode: "number" }),
  weekendPaise: bigint("weekend_paise", { mode: "number" }), // Fri 18:00 → Mon 10:00
  depositPaise: bigint("deposit_paise", { mode: "number" }).notNull().default(0),
  replacementValuePaise: bigint("replacement_value_paise", { mode: "number" }), // caps dispute claims
  checklistTemplate: jsonb("checklist_template").notNull().default([]), // ChecklistItem[]
  requiredPhotoSlots: jsonb("required_photo_slots").notNull().default([]), // ["front","back","serial","accessories"]
  status: text("status").notNull().default("active"),       // active | paused | archived
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("listings_society_cat").on(t.societyId, t.category, t.status),
  check("listing_has_price", sql`coalesce(${t.hourlyPaise}, ${t.dailyPaise}, ${t.weekendPaise}) is not null`),
  check("deposit_le_replacement", sql`${t.replacementValuePaise} is null or ${t.depositPaise} <= ${t.replacementValuePaise}`),
]);

export const bookingState = pgEnum("booking_state", [
  "REQUESTED", "ACCEPTED", "DEPOSIT_HELD", "HANDOVER_PENDING", "ACTIVE",
  "OVERDUE", "RETURN_PENDING", "COMPLETED", "DISPUTED", "RESOLVED",
  "DECLINED", "EXPIRED", "CANCELLED",
]);

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  societyId: uuid("society_id").notNull().references(() => societies.id),
  listingId: uuid("listing_id").notNull().references(() => listings.id),
  lenderId: uuid("lender_id").notNull().references(() => users.id),
  borrowerId: uuid("borrower_id").notNull().references(() => users.id),
  state: bookingState("state").notNull().default("REQUESTED"),
  version: integer("version").notNull().default(0),          // optimistic concurrency
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  feePaise: bigint("fee_paise", { mode: "number" }).notNull(),
  depositPaise: bigint("deposit_paise", { mode: "number" }).notNull(),
  platformFeePaise: bigint("platform_fee_paise", { mode: "number" }).notNull(),
  checklistSnapshot: jsonb("checklist_snapshot").notNull(),  // frozen copy of listing template
  photoSlotsSnapshot: jsonb("photo_slots_snapshot").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  index("bookings_listing_time").on(t.listingId, t.startsAt, t.endsAt),
  check("no_self_borrow", sql`${t.lenderId} <> ${t.borrowerId}`),
  check("time_order", sql`${t.endsAt} > ${t.startsAt}`),
]);
// Plus, in raw SQL migration (Drizzle can't express it): no double-booking of an item
//   CREATE EXTENSION IF NOT EXISTS btree_gist;
//   ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist
//     (listing_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
//     WHERE (state IN ('ACCEPTED','DEPOSIT_HELD','HANDOVER_PENDING','ACTIVE','OVERDUE','RETURN_PENDING'));

export const bookingEvents = pgTable("booking_events", {           // append-only audit log
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  fromState: bookingState("from_state"),
  toState: bookingState("to_state").notNull(),
  actorId: uuid("actor_id"),                                       // null = system/timer/webhook
  reason: text("reason").notNull(),
  data: jsonb("data").notNull().default({}),
  at: ts("at").notNull().defaultNow(),
}, (t) => [index("booking_events_booking").on(t.bookingId, t.id)]);

export const inspectionPhase = pgEnum("inspection_phase", ["handover", "return"]);
export const party = pgEnum("party", ["lender", "borrower"]);

export const inspections = pgTable("inspections", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  phase: inspectionPhase("phase").notNull(),
  party: party("party").notNull(),
  submittedBy: uuid("submitted_by").notNull().references(() => users.id),
  checklistAnswers: jsonb("checklist_answers").notNull(),         // { itemId: { ok: bool, value?: string|number, note?: string } }
  lat: doublePrecision("lat"), lng: doublePrecision("lng"), accuracyM: doublePrecision("accuracy_m"),
  withinGeofence: boolean("within_geofence").notNull(),
  clientCapturedAt: ts("client_captured_at").notNull(),
  submittedAt: ts("submitted_at").notNull().defaultNow(),
  // Counter-party acknowledgement of THIS submission
  ackBy: uuid("ack_by").references(() => users.id),
  ackResult: text("ack_result"),                                  // agreed | objected
  ackNote: text("ack_note"),
  ackAt: ts("ack_at"),
}, (t) => [uniqueIndex("inspections_one_per_party").on(t.bookingId, t.phase, t.party)]);

export const inspectionMedia = pgTable("inspection_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  inspectionId: uuid("inspection_id").references(() => inspections.id), // null until finalized
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  uploaderId: uuid("uploader_id").notNull().references(() => users.id),
  phase: inspectionPhase("phase").notNull(),
  slot: text("slot").notNull(),                                    // matches photo_slots_snapshot, or "extra"
  r2Key: text("r2_key").notNull().unique(),
  mime: text("mime").notNull(),
  bytes: integer("bytes"),
  sha256Client: text("sha256_client").notNull(),
  sha256Server: text("sha256_server"),
  lat: doublePrecision("lat"), lng: doublePrecision("lng"), accuracyM: doublePrecision("accuracy_m"),
  clientCapturedAt: ts("client_captured_at").notNull(),
  receivedAt: ts("received_at"),
  status: text("status").notNull().default("presigned"),           // presigned | verified | rejected
});

// UPI only. mode decides how the deposit exists:
//   declared     – Phase 1, no money moves; an award becomes a recorded debt
//   p2p          – Phase 1, borrower paid lender's VPA directly; lender must refund via UPI
//   upi_block    – Phase 2, UPI one-time mandate: blocked in borrower's bank, debited only on award
//   capture_refund – Phase 2 fallback if blocks are unavailable for our merchant category
export const depositMode = pgEnum("deposit_mode", ["declared", "p2p", "upi_block", "capture_refund"]);
export const depositStatus = pgEnum("deposit_status", [
  "pending", "blocked", "released", "partially_debited", "debited", "debt_recorded", "revoked_by_payer", "failed",
]);

export const deposits = pgTable("deposits", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().unique().references(() => bookings.id),
  mode: depositMode("mode").notNull(),
  provider: text("provider"),                                      // razorpay | cashfree | null (Phase 1)
  feeOrderId: text("fee_order_id").unique(),
  feePaymentId: text("fee_payment_id").unique(),
  feeUtr: text("fee_utr"),                                         // UPI ref (Phase 1: borrower-entered)
  feeTransferId: text("fee_transfer_id"),                          // Route transfer, on hold until completion
  mandateId: text("mandate_id").unique(),                          // UPI block (Phase 2)
  blockValidUntil: ts("block_valid_until"),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(), // deposit only
  debitedPaise: bigint("debited_paise", { mode: "number" }).notNull().default(0),
  debitPaymentId: text("debit_payment_id"),
  status: depositStatus("status").notNull().default("pending"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [check("deposit_conserved", sql`${t.debitedPaise} <= ${t.amountPaise}`)]);

export const paymentWebhookEvents = pgTable("payment_webhook_events", { // idempotency for webhooks
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
});

export const disputeStatus = pgEnum("dispute_status", [
  "open", "awaiting_response", "under_review", "escalated", "resolved", "withdrawn",
]);

export const disputes = pgTable("disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().unique().references(() => bookings.id),
  raisedBy: uuid("raised_by").notNull().references(() => users.id),
  category: text("category").notNull(),             // damage | missing_part | not_returned | not_as_described | late
  description: text("description").notNull(),
  claimedPaise: bigint("claimed_paise", { mode: "number" }).notNull(),
  responseText: text("response_text"),
  responseOfferPaise: bigint("response_offer_paise", { mode: "number" }), // settlement offer
  status: disputeStatus("status").notNull().default("open"),
  arbiterId: uuid("arbiter_id").references(() => users.id),
  awardPaise: bigint("award_paise", { mode: "number" }),
  rulingNote: text("ruling_note"),
  resolvedAt: ts("resolved_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const ratings = pgTable("ratings", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id),
  raterId: uuid("rater_id").notNull().references(() => users.id),
  rateeId: uuid("ratee_id").notNull().references(() => users.id),
  stars: smallint("stars").notNull(),
  punctual: boolean("punctual"), careful: boolean("careful"), asDescribed: boolean("as_described"),
  comment: text("comment"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ratings_one_per_side").on(t.bookingId, t.raterId),
  check("stars_range", sql`${t.stars} between 1 and 5`),
]);
```

### Checklist template shape (jsonb)

```ts
type ChecklistItem =
  | { id: string; label: string; type: "bool" }                         // "Charger included"
  | { id: string; label: string; type: "percent" }                      // "Battery level"
  | { id: string; label: string; type: "choice"; options: string[] }    // "Scratches": none/minor/visible
  | { id: string; label: string; type: "count" }                        // "Drill bits in case": 12
  | { id: string; label: string; type: "text" };
```

Category presets ship with the app (power tool: charger, battery %, bit count, chuck works, case; DSLR: lens caps, shutter count, sensor dust photo, battery, strap, SD card removed; stroller: folds/unfolds, brakes, canopy, stains). Lender edits them per listing. **The booking freezes a snapshot**, so editing a listing mid-rental can't move goalposts.

### Trust score

Bayesian, per user, per society-visible, recomputed by an activity on every `COMPLETED`/`RESOLVED`:

```
score = (C·m + Σ stars) / (C + n)        C=5, m=4.0 prior
      − 0.5 × (disputes lost in last 12 mo)
      − 0.2 × (overdue returns in last 12 mo)
      + 0.1 × min(completed, 20) / 20
clamped to [0, 5]; shown as a badge + "N completed in your society"
```

Gates: score < 3.0 or < 1 completed → lender may require higher deposit; score < 2.0 → borrowing paused pending admin review.

---

## 5. Booking state machine

```
                  decline/12h timeout             30 min no payment
     ┌──────────► DECLINED / EXPIRED ◄──────────────────────┐
     │                                                       │
REQUESTED ──lender accepts──► ACCEPTED ─UPI fee + block ok─► DEPOSIT_HELD
     │                            │                              │ startsAt − 1h (timer)
     └── borrower cancels ──► CANCELLED ◄── cancel (pre-handover, policy refund)
                                                                 ▼
                                                        HANDOVER_PENDING
                        both inspections + borrower ack of lender's │
                        (or borrower objects → stays pending, renegotiate/cancel)
                                                                 ▼
                                                              ACTIVE ──endsAt passes──► OVERDUE
                                                                 │                         │
                                         borrower submits return │◄────────────────────────┘
                                                                 ▼
                                                         RETURN_PENDING
                      lender agrees, OR 24 h silence │            │ lender objects / raises dispute (≤24 h)
                                                     ▼            ▼
                                                COMPLETED     DISPUTED ──ruling / settlement──► RESOLVED
                                         (release UPI block,        │ 72 h no ruling → escalated to platform
                                          release fee hold)
```

Transition table (the code enforces exactly this; anything else is rejected):

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| — | `request` | approved member, same society, no overlap | REQUESTED | notify lender; start workflow |
| REQUESTED | `accept` | actor = lender | ACCEPTED | create Razorpay order; notify borrower |
| REQUESTED | `decline` / 12 h timer | | DECLINED / EXPIRED | |
| ACCEPTED | `paymentEvent` fee + deposit block (webhook, or lender "Received" in Phase 1) | amount matches | DEPOSIT_HELD | Phase 2: Route transfer of fee **on hold** |
| ACCEPTED | 30 min timer | | EXPIRED | release slot |
| ACCEPTED/DEPOSIT_HELD | `cancel` | before handover | CANCELLED | refund per policy |
| DEPOSIT_HELD | `startsAt − 1h` timer | | HANDOVER_PENDING | push both parties "meet for handover" |
| HANDOVER_PENDING | `inspectionSubmitted` ×2 + borrower ack=agreed | all photo slots verified | ACTIVE | |
| HANDOVER_PENDING | 24 h past startsAt, no handover | | CANCELLED | full refund; lender no-show strike |
| ACTIVE | `endsAt` timer | | OVERDUE | nudges at +1 h, +6 h, +24 h; admin alerted at +48 h |
| ACTIVE/OVERDUE | `inspectionSubmitted` (return, borrower) | | RETURN_PENDING | notify lender |
| RETURN_PENDING | lender return inspection, ack=agreed | | COMPLETED | release UPI block (or prompt P2P refund); release fee hold; ask ratings |
| RETURN_PENDING | 24 h timer, lender silent | | COMPLETED | same as above ("silence = acceptance", stated in T&Cs) |
| RETURN_PENDING | `raiseDispute` (lender) | ≤ 24 h, claim ≤ deposit… or ≤ replacement value | DISPUTED | freeze deposit; open dispute |
| ACTIVE/OVERDUE | `raiseDispute` (either) | e.g. item defective, not returned 72 h+ | DISPUTED | |
| DISPUTED | `settle` (both accept offer) / `rule` (arbiter) | arbiter not a party | RESOLVED | debit award from UPI block, release the rest; transfer award to lender; release fee hold |

Skill gigs use the same table with handover inspection skipped (`deposit = 0`, no photo slots) and "return" = "delivered".

---

## 6. UI/UX flows & wireframes

### 6.1 Handover — Lender (step 1 of 2)

```
┌─────────────────────────────────────┐
│ ←  Handover · Bosch GSB 500 Drill   │
│ Borrower: Priya S. · B-1204 ★4.8 (11)│
├─────────────────────────────────────┤
│ 📍 Inside Prestige Lakeside ✓ (±12m) │
│                                     │
│ PHOTOS (in-app camera only)  3 / 4  │
│ ┌───────┐┌───────┐┌───────┐┌ ─ ─ ─ ┐│
│ │ front ││ back  ││serial ││ + acc. ││
│ │  ✓    ││  ✓    ││  ✓    ││ needed ││
│ └───────┘└───────┘└───────┘└ ─ ─ ─ ┘│
│ [ 🎥 Optional 15-sec video ]         │
│                                     │
│ CHECKLIST                           │
│ ☑ Charger included                  │
│ ☑ Carry case                        │
│ Battery level      [ 80 % ]         │
│ Drill bits in case [ 12   ]         │
│ Scratches   (•) none ( ) minor ( )… │
│ Note: small scuff near grip, pre-ex.│
├─────────────────────────────────────┤
│ UPI block: ₹3,000 · Fee ₹350/day    │
│ [   Submit & show to borrower   ]   │  ← disabled until all slots ✓
└─────────────────────────────────────┘
```

### 6.2 Handover — Borrower (step 2 of 2)

```
┌─────────────────────────────────────┐
│ ←  Confirm handover                 │
├─────────────────────────────────────┤
│ Lender's photos & checklist (14:02) │
│ [front][back][serial][accessories]  │
│ Charger ✓ Case ✓ Battery 80% Bits 12│
│ Scratches: none · "small scuff…"    │
│                                     │
│ YOUR PHOTOS (same slots)     4 / 4  │
│ [front✓][back✓][serial✓][acc.✓]     │
│                                     │
│ Does the item match the above?      │
│ [ ✓ Yes, matches — start rental ]   │
│ [ ✗ Something's different… ]        │  → note + extra photo, lender notified,
│                                     │     can amend or cancel (full refund)
│ Return by: Sun 3 Nov, 10:00 AM      │
└─────────────────────────────────────┘
```

Both submissions can happen on one phone in a pinch? **No** — each party's inspection must come from their own authenticated device; that's what makes the handshake two-sided.

### 6.3 Return — Lender review (side-by-side)

```
┌─────────────────────────────────────┐
│ ←  Review return · Drill            │
│ Returned Sun 09:41 (on time ✓)      │
├──────────────────┬──────────────────┤
│  HANDOVER (Fri)  │   RETURN (Sun)   │
│  [ front ]       │   [ front ]      │  ← swipe slot-by-slot,
│                  │                  │     pinch-zoom synced
│ Battery 80%      │ Battery 35%  ⚠   │  ← diffs auto-highlighted
│ Bits 12          │ Bits 11      ⚠   │
│ Scratches none   │ Scratches none   │
├──────────────────┴──────────────────┤
│ Auto-accepts in 23h 12m             │
│ [ ✓ All good — release deposit ]    │
│ [ ⚑ Report an issue ]               │
└─────────────────────────────────────┘
```

### 6.4 Dispute & admin arbitration

```
Lender: Report issue                    Society admin: Dispute #D-0042
┌───────────────────────────┐          ┌─────────────────────────────────────────┐
│ Category: (•) missing part│          │ Drill · Lender A-302 vs Borrower B-1204 │
│ Claim: ₹ 250  (max ₹3,000)│          │ Claim ₹250 · Offer ₹150 · 41h left      │
│ Describe: 1 bit missing   │          ├────────────────────┬────────────────────┤
│ [+ extra photos]          │          │ handover/accessory │ return/accessory   │
│ [ Submit dispute ]        │          │ (photo, 12 bits)   │ (photo, 11 bits)   │
└───────────────────────────┘          │ geofence ✓ 14:02   │ geofence ✓ 09:41   │
                                       ├────────────────────┴────────────────────┤
Borrower gets: [Accept ₹250]           │ Timeline: requested → … → disputed       │
[Offer ₹__] [Respond + photos]         │ Chat (both parties + admin)              │
                                       │ Award ₹ [ 150 ]  Note [............]     │
                                       │ [ Rule ]   [ Escalate to 3PandaLabs ]    │
                                       └─────────────────────────────────────────┘
```

Dispute rules: claim capped at deposit (deposit is the only money we can move); anything larger is advised off-platform with the evidence pack exported as PDF. Arbiter must not be either party or in either party's unit.

---

## 7. MVP code (api/, in RentVault's route → Temporal style)

### 7.1 Transition core — `api/src/booking/transition.ts`

```ts
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookingEvents, bookings } from "../db/schema.js";

export type BookingState = (typeof bookings.$inferSelect)["state"];

const ALLOWED: Record<BookingState, readonly BookingState[]> = {
  REQUESTED: ["ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED"],
  ACCEPTED: ["DEPOSIT_HELD", "EXPIRED", "CANCELLED"],
  DEPOSIT_HELD: ["HANDOVER_PENDING", "CANCELLED"],
  HANDOVER_PENDING: ["ACTIVE", "CANCELLED", "DISPUTED"],
  ACTIVE: ["OVERDUE", "RETURN_PENDING", "DISPUTED"],
  OVERDUE: ["RETURN_PENDING", "DISPUTED"],
  RETURN_PENDING: ["COMPLETED", "DISPUTED"],
  DISPUTED: ["RESOLVED"],
  COMPLETED: [], RESOLVED: [], DECLINED: [], EXPIRED: [], CANCELLED: [],
};

export class TransitionConflict extends Error {
  constructor(public bookingId: string, public expected: BookingState[], public to: BookingState) {
    super(`booking ${bookingId}: cannot move to ${to} from current state (expected one of ${expected.join(",")})`);
  }
}

/**
 * The ONLY way booking.state changes. Conditional UPDATE makes it race-safe
 * (two taps, a webhook and a timer can all fire at once — exactly one wins),
 * and the event row is written in the same transaction.
 */
export async function transition(opts: {
  bookingId: string;
  from: BookingState | BookingState[];
  to: BookingState;
  actorId: string | null;
  reason: string;
  data?: Record<string, unknown>;
  tx?: Parameters<Parameters<typeof db.transaction>[0]>[0];
}): Promise<void> {
  const from = Array.isArray(opts.from) ? opts.from : [opts.from];
  for (const f of from) {
    if (!ALLOWED[f].includes(opts.to)) throw new Error(`illegal transition ${f} -> ${opts.to}`);
  }
  const run = async (tx: NonNullable<typeof opts.tx>) => {
    const [prev] = await tx
      .select({ state: bookings.state })
      .from(bookings)
      .where(eq(bookings.id, opts.bookingId))
      .for("update");
    if (!prev || !from.includes(prev.state)) throw new TransitionConflict(opts.bookingId, from, opts.to);

    await tx
      .update(bookings)
      .set({ state: opts.to, version: sql`${bookings.version} + 1`, updatedAt: new Date() })
      .where(and(eq(bookings.id, opts.bookingId), eq(bookings.state, prev.state)));

    await tx.insert(bookingEvents).values({
      bookingId: opts.bookingId,
      fromState: prev.state,
      toState: opts.to,
      actorId: opts.actorId,
      reason: opts.reason,
      data: opts.data ?? {},
    });
  };
  return opts.tx ? run(opts.tx) : db.transaction(run);
}
```

### 7.2 Routes — `api/src/routes/bookings.ts`

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { requireApprovedMember } from "../plugins/authz.js";
import { sendWorkflow, signalBooking } from "../temporal/runWorkflow.js";

const createBooking = z.object({
  listingId: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  pricing: z.enum(["hourly", "daily", "weekend"]),
});

const geo = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().max(5000),
  capturedAt: z.string().datetime(),
});

const presignBody = z.object({
  phase: z.enum(["handover", "return"]),
  slot: z.string().min(1).max(40),
  mime: z.enum(["image/jpeg", "image/heic", "video/mp4"]),
  bytes: z.number().int().positive().max(40 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  geo,
});

const submitInspection = z.object({
  phase: z.enum(["handover", "return"]),
  mediaIds: z.array(z.string().uuid()).min(1).max(20),
  checklistAnswers: z.record(z.object({
    ok: z.boolean().optional(),
    value: z.union([z.string().max(200), z.number()]).optional(),
    note: z.string().max(500).optional(),
  })),
  geo,
});

const ack = z.object({
  phase: z.enum(["handover", "return"]),
  result: z.enum(["agreed", "objected"]),
  note: z.string().max(1000).optional(),
});

const raiseDispute = z.object({
  category: z.enum(["damage", "missing_part", "not_returned", "not_as_described", "late"]),
  description: z.string().min(10).max(2000),
  claimedPaise: z.number().int().positive(),
  mediaIds: z.array(z.string().uuid()).max(10).default([]),
});

const ruling = z.object({ awardPaise: z.number().int().nonnegative(), note: z.string().min(5).max(2000) });

export async function bookingRoutes(app: FastifyInstance) {
  // 1. Initiate — validates + inserts REQUESTED in an activity, then starts the long-running workflow.
  app.post("/bookings", { preHandler: [requireAuth, requireApprovedMember], schema: { body: createBooking } },
    async (req, reply) =>
      sendWorkflow(reply, "createBookingWorkflow", [{ borrowerId: req.userId!, ...(req.body as z.infer<typeof createBooking>) }], 201));

  app.post("/bookings/:id/accept", { preHandler: requireAuth }, async (req, reply) =>
    signalBooking(reply, (req.params as { id: string }).id, "accept", { actorId: req.userId! }));

  app.post("/bookings/:id/decline", { preHandler: requireAuth }, async (req, reply) =>
    signalBooking(reply, (req.params as { id: string }).id, "decline", { actorId: req.userId! }));

  // 2. Evidence upload: presign → client PUTs to R2 → finalize (server re-hashes).
  app.post("/bookings/:id/media/presign", { preHandler: requireAuth, schema: { body: presignBody } },
    async (req, reply) =>
      sendWorkflow(reply, "presignInspectionMediaWorkflow",
        [{ bookingId: (req.params as { id: string }).id, userId: req.userId!, ...(req.body as z.infer<typeof presignBody>) }], 201));

  app.post("/bookings/:id/media/:mediaId/finalize", { preHandler: requireAuth }, async (req, reply) => {
    const { id, mediaId } = req.params as { id: string; mediaId: string };
    return sendWorkflow(reply, "finalizeInspectionMediaWorkflow", [{ bookingId: id, mediaId, userId: req.userId! }]);
  });

  // 3. Two-party inspection + counter-party acknowledgement.
  app.post("/bookings/:id/inspections", { preHandler: requireAuth, schema: { body: submitInspection } },
    async (req, reply) =>
      signalBooking(reply, (req.params as { id: string }).id, "inspectionSubmitted",
        { actorId: req.userId!, ...(req.body as z.infer<typeof submitInspection>) }));

  app.post("/bookings/:id/inspections/ack", { preHandler: requireAuth, schema: { body: ack } },
    async (req, reply) =>
      signalBooking(reply, (req.params as { id: string }).id, "inspectionAcked",
        { actorId: req.userId!, ...(req.body as z.infer<typeof ack>) }));

  // 4. Disputes.
  app.post("/bookings/:id/disputes", { preHandler: requireAuth, schema: { body: raiseDispute } },
    async (req, reply) =>
      signalBooking(reply, (req.params as { id: string }).id, "raiseDispute",
        { actorId: req.userId!, ...(req.body as z.infer<typeof raiseDispute>) }));

  app.post("/bookings/:id/disputes/ruling", { preHandler: requireAuth, schema: { body: ruling } },
    async (req, reply) =>
      signalBooking(reply, (req.params as { id: string }).id, "ruling",
        { actorId: req.userId!, ...(req.body as z.infer<typeof ruling>) }));
}
```

`signalBooking` is a thin wrapper next to the existing `sendWorkflow`: it runs a short **validating update** (Temporal `executeUpdate`) on `booking-<id>` so the HTTP caller gets a synchronous 2xx/4xx (e.g. 409 on `TransitionConflict`, 403 if the actor isn't the right party), instead of a fire-and-forget signal.

### 7.3 Razorpay webhook — `api/src/routes/webhooks.ts`

```ts
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { paymentWebhookEvents } from "../db/schema.js";
import { env } from "../env.js";
import { temporal } from "../temporal/client.js";

export async function webhookRoutes(app: FastifyInstance) {
  // Raw body is required for HMAC verification — register the parser only in this plugin scope.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post("/webhooks/razorpay", async (req, reply) => {
    const raw = req.body as Buffer;
    const sig = req.headers["x-razorpay-signature"];
    const expected = crypto.createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");
    if (typeof sig !== "string" || sig.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return reply.code(400).send({ error: "bad signature" });
    }

    const eventId = req.headers["x-razorpay-event-id"];
    if (typeof eventId !== "string") return reply.code(400).send({ error: "missing event id" });
    const evt = JSON.parse(raw.toString("utf8"));

    // Idempotent: Razorpay retries; the PK makes a duplicate a no-op.
    const inserted = await db.insert(paymentWebhookEvents)
      .values({ eventId, type: evt.event, payload: evt })
      .onConflictDoNothing()
      .returning({ eventId: paymentWebhookEvents.eventId });
    if (inserted.length === 0) return reply.code(200).send({ ok: true, duplicate: true });

    // Event names are Razorpay's at time of writing — confirm against the UPI mandate docs at onboarding.
    const bookingId = (evt.payload?.payment?.entity?.notes?.booking_id
                    ?? evt.payload?.token?.entity?.notes?.booking_id) as string | undefined;
    if (bookingId) {
      const wf = temporal.workflow.getHandle(`booking-${bookingId}`);
      if (evt.event === "payment.captured" && evt.payload.payment.entity.method === "upi") {
        const p = evt.payload.payment.entity;
        // Fee payment, or the mandate's authorisation payment — notes.kind tells them apart.
        await wf.signal("paymentEvent", { kind: p.notes.kind as "fee" | "deposit_block",
          paymentId: p.id, orderId: p.order_id, amountPaise: p.amount, mandateId: p.token_id ?? null });
      } else if (evt.event === "token.confirmed") {           // UPI block approved by borrower's bank
        await wf.signal("paymentEvent", { kind: "deposit_block", mandateId: evt.payload.token.entity.id });
      } else if (evt.event === "token.cancelled" || evt.event === "token.paused") {
        await wf.signal("paymentEvent", { kind: "block_revoked_by_payer", mandateId: evt.payload.token.entity.id });
      }
    }
    // transfer.* / refund.* events are recorded for reconciliation only.
    return reply.code(200).send({ ok: true });
  });
}
```

### 7.4 The booking workflow — `api/src/temporal/workflows/booking.ts`

```ts
import {
  condition, defineSignal, defineUpdate, proxyActivities, setHandler, sleep, ApplicationFailure,
} from "@temporalio/workflow";
import type * as acts from "../activities/booking.js";

const a = proxyActivities<typeof acts>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 10, initialInterval: "2s", backoffCoefficient: 2,
           nonRetryableErrorTypes: ["TransitionConflict", "Forbidden", "ValidationError"] },
});

export const accept = defineUpdate<void, [{ actorId: string }]>("accept");
export const decline = defineUpdate<void, [{ actorId: string }]>("decline");
export const inspectionSubmitted = defineUpdate<void, [acts.InspectionInput]>("inspectionSubmitted");
export const inspectionAcked = defineUpdate<void, [acts.AckInput]>("inspectionAcked");
export const raiseDispute = defineUpdate<{ disputeId: string }, [acts.DisputeInput]>("raiseDispute");
export const ruling = defineUpdate<void, [acts.RulingInput]>("ruling");
// From the Razorpay webhook (Phase 2) or from the lender's "Received" tap on a P2P UPI payment (Phase 1).
export const paymentEvent = defineSignal<[acts.PaymentEvent]>("paymentEvent");

const HOUR = 3_600_000;

export async function bookingWorkflow(b: { bookingId: string; startsAt: number; endsAt: number }) {
  let state: acts.BookingState = "REQUESTED";
  let fee: acts.PaymentEvent | null = null;      // UPI fee received
  let block: acts.PaymentEvent | null = null;    // UPI deposit block confirmed (or not needed)
  let blockRevoked = false;
  const needsBlock = await a.depositNeedsBlock({ bookingId: b.bookingId }); // false for declared / p2p-without-deposit
  const done = { handoverLender: false, handoverBorrower: false, handoverAck: false,
                 returnBorrower: false, returnLenderAgreed: false };
  let disputed = false, ruled = false;

  // ---- handlers: each validates the actor in an activity, then persists via transition() ----
  setHandler(accept, async ({ actorId }) => {
    if (state !== "REQUESTED") throw ApplicationFailure.nonRetryable("not awaiting acceptance", "TransitionConflict");
    await a.acceptAndCreateOrder({ bookingId: b.bookingId, actorId }); // transition + Razorpay order
    state = "ACCEPTED";
  });
  setHandler(decline, async ({ actorId }) => {
    if (state !== "REQUESTED") throw ApplicationFailure.nonRetryable("not awaiting acceptance", "TransitionConflict");
    await a.declineBooking({ bookingId: b.bookingId, actorId });
    state = "DECLINED";
  });
  setHandler(paymentEvent, (p) => {
    if (p.kind === "fee") fee ??= p;
    else if (p.kind === "deposit_block") block ??= p;
    else if (p.kind === "block_revoked_by_payer") blockRevoked = true;
  });

  setHandler(inspectionSubmitted, async (input) => {
    const ok = (input.phase === "handover" && state === "HANDOVER_PENDING")
            || (input.phase === "return" && ["ACTIVE", "OVERDUE", "RETURN_PENDING"].includes(state));
    if (!ok) throw ApplicationFailure.nonRetryable(`no ${input.phase} inspection in ${state}`, "TransitionConflict");
    const { party } = await a.recordInspection({ bookingId: b.bookingId, ...input }); // checks slots, geofence, hashes
    if (input.phase === "handover") party === "lender" ? (done.handoverLender = true) : (done.handoverBorrower = true);
    if (input.phase === "return" && party === "borrower") {
      await a.moveToReturnPending({ bookingId: b.bookingId, actorId: input.actorId });
      done.returnBorrower = true; state = "RETURN_PENDING";
    }
  });

  setHandler(inspectionAcked, async (input) => {
    const { party } = await a.recordAck({ bookingId: b.bookingId, ...input });
    if (input.phase === "handover" && party === "borrower") done.handoverAck = input.result === "agreed";
    if (input.phase === "return" && party === "lender") done.returnLenderAgreed = input.result === "agreed";
  });

  setHandler(raiseDispute, async (input) => {
    if (!["HANDOVER_PENDING", "ACTIVE", "OVERDUE", "RETURN_PENDING"].includes(state))
      throw ApplicationFailure.nonRetryable(`cannot dispute in ${state}`, "TransitionConflict");
    const r = await a.openDispute({ bookingId: b.bookingId, ...input }); // caps claim, freezes deposit
    disputed = true; state = "DISPUTED";
    return r;
  });

  setHandler(ruling, async (input) => {
    if (state !== "DISPUTED") throw ApplicationFailure.nonRetryable("no open dispute", "TransitionConflict");
    await a.validateArbiter({ bookingId: b.bookingId, arbiterId: input.actorId });
    await a.settleDispute({ bookingId: b.bookingId, ...input });  // debit award from UPI block + release rest + release fee
    ruled = true; state = "RESOLVED";
  });

  // ---- 1. lender has 12 h to accept ----
  if (!(await condition(() => state !== "REQUESTED", 12 * HOUR))) {
    await a.expire({ bookingId: b.bookingId, from: "REQUESTED", reason: "lender_no_response" });
    return;
  }
  if (state !== "ACCEPTED") return; // declined / cancelled

  // ---- 2. borrower has 30 min to pay the fee via UPI and approve the deposit block ----
  // (Phase 1 P2P: 2 h, because the lender has to tap "Received".)
  const payWindow = (await a.isPhase1({ bookingId: b.bookingId })) ? 2 * HOUR : 30 * 60_000;
  if (!(await condition(() => fee !== null && (!needsBlock || block !== null), payWindow))) {
    await a.expire({ bookingId: b.bookingId, from: "ACCEPTED", reason: "payment_timeout" }); // revokes any partial block / refunds fee
    return;
  }
  await a.confirmDeposit({ bookingId: b.bookingId, fee: fee!, block });  // DEPOSIT_HELD + fee transfer on_hold
  state = "DEPOSIT_HELD";
  // If the borrower revokes the UPI block from their bank app mid-rental, flag it (doesn't stop the rental).
  void condition(() => blockRevoked).then(() => a.flagBlockRevoked({ bookingId: b.bookingId }));

  // ---- 3. handover window opens 1 h before start ----
  const untilHandover = b.startsAt - HOUR - Date.now();               // workflow Date.now() is deterministic
  if (untilHandover > 0) await sleep(untilHandover);
  await a.openHandover({ bookingId: b.bookingId });
  state = "HANDOVER_PENDING";

  const handedOver = await condition(
    () => (done.handoverLender && done.handoverBorrower && done.handoverAck) || disputed,
    Math.max(b.startsAt + 24 * HOUR - Date.now(), HOUR),
  );
  if (!handedOver) {
    await a.cancelNoHandover({ bookingId: b.bookingId });              // full refund, lender strike
    return;
  }
  if (!disputed) { await a.activate({ bookingId: b.bookingId }); state = "ACTIVE"; }

  // ---- 4. rental period; overdue nudges ----
  if (!disputed) {
    const returned = await condition(() => done.returnBorrower || disputed, Math.max(b.endsAt - Date.now(), 0));
    if (!returned) {
      await a.markOverdue({ bookingId: b.bookingId }); state = "OVERDUE";
      for (const waitH of [1, 5, 18, 24]) {                             // +1h, +6h, +24h, +48h(admin)
        if (await condition(() => done.returnBorrower || disputed, waitH * HOUR)) break;
        await a.nudgeOverdue({ bookingId: b.bookingId, escalateToAdmin: waitH === 24 });
      }
      await condition(() => done.returnBorrower || disputed);
    }
  }

  // ---- 5. lender review: agree, dispute, or 24 h silence = acceptance ----
  if (!disputed) {
    await condition(() => done.returnLenderAgreed || disputed, 24 * HOUR);
    if (!disputed) {
      await a.complete({ bookingId: b.bookingId, auto: !done.returnLenderAgreed }); // release UPI block + release fee
      state = "COMPLETED";
      await a.recomputeTrust({ bookingId: b.bookingId });
      return;
    }
  }

  // ---- 6. dispute: 72 h for society admin, then platform escalation ----
  if (!(await condition(() => ruled, 72 * HOUR))) {
    await a.escalateDispute({ bookingId: b.bookingId });
    await condition(() => ruled);
  }
  await a.recomputeTrust({ bookingId: b.bookingId });
}
```

### 7.5 Key activities — `api/src/temporal/activities/booking.ts` (excerpt)

```ts
import crypto from "node:crypto";
import { ApplicationFailure } from "@temporalio/activity";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookings, deposits, disputes, inspectionMedia, inspections, listings, societies } from "../../db/schema.js";
import { getObject, presignUpload } from "../../plugins/r2.js";
import { payments } from "../../payments/index.js";       // payments(mode) → DepositProvider (UPI P2P links | Razorpay UPI)
import { transition, TransitionConflict } from "../../booking/transition.js";
export type { BookingState } from "../../booking/transition.js";

const forbidden = (m: string) => ApplicationFailure.nonRetryable(m, "Forbidden");
const invalid = (m: string) => ApplicationFailure.nonRetryable(m, "ValidationError");

function partyOf(bk: typeof bookings.$inferSelect, userId: string): "lender" | "borrower" {
  if (bk.lenderId === userId) return "lender";
  if (bk.borrowerId === userId) return "borrower";
  throw forbidden("not a party to this booking");
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6_371_000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- create (called by createBookingWorkflow before starting bookingWorkflow) ----------
export async function createBooking(i: {
  borrowerId: string; listingId: string; startsAt: string; endsAt: string; pricing: "hourly" | "daily" | "weekend";
}) {
  const [l] = await db.select().from(listings).where(and(eq(listings.id, i.listingId), eq(listings.status, "active")));
  if (!l) throw invalid("listing not available");
  // requireApprovedMember already checked the borrower belongs to *a* society; enforce it's THIS one.
  await assertApprovedMember(i.borrowerId, l.societyId);

  const start = new Date(i.startsAt), end = new Date(i.endsAt);
  const fee = priceFor(l, i.pricing, start, end);          // integer paise; throws if pricing unit unavailable
  const platformFee = Math.max(1000, Math.round(fee * 0.08));

  try {
    const [bk] = await db.insert(bookings).values({
      societyId: l.societyId, listingId: l.id, lenderId: l.ownerId, borrowerId: i.borrowerId,
      startsAt: start, endsAt: end, feePaise: fee, depositPaise: l.depositPaise, platformFeePaise: platformFee,
      checklistSnapshot: l.checklistTemplate, photoSlotsSnapshot: l.requiredPhotoSlots,
    }).returning();
    return { bookingId: bk.id, startsAt: start.getTime(), endsAt: end.getTime() };
  } catch (e) {
    if (isExclusionViolation(e)) throw invalid("item already booked for that time"); // bookings_no_overlap
    throw e;
  }
}

// ---------- accept: transition + UPI fee request + UPI deposit block ----------
export type PaymentEvent =
  | { kind: "fee"; paymentId?: string; orderId?: string; amountPaise?: number; utr?: string }
  | { kind: "deposit_block"; mandateId: string; paymentId?: string; amountPaise?: number }
  | { kind: "block_revoked_by_payer"; mandateId: string };

export async function acceptAndCreateOrder({ bookingId, actorId }: { bookingId: string; actorId: string }) {
  const [bk] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (partyOf(bk, actorId) !== "lender") throw forbidden("only the lender can accept");
  const lender = await lenderPayoutInfo(bk.lenderId);   // { vpa, routeAccountId? } — throws if no VPA on file
  const mode = await depositModeFor(bk);                // society setting + phase: declared | p2p | upi_block | capture_refund

  // Block must outlive: rental + 24 h return review + 72 h dispute SLA + slack.
  const blockValidUntil = new Date(bk.endsAt.getTime() + (24 + 72 + 24) * 3_600_000);
  const started = await payments(mode).start({        // idempotent on bookingId
    bookingId, feePaise: bk.feePaise, depositPaise: bk.depositPaise, platformFeePaise: bk.platformFeePaise,
    lenderVpa: lender.vpa, lenderAccountId: lender.routeAccountId, blockValidUntil,
  });
  await db.transaction(async (tx) => {
    await transition({ tx, bookingId, from: "REQUESTED", to: "ACCEPTED", actorId, reason: "lender_accepted",
                       data: { upiIntents: started.upiIntents } });      // app opens these in the user's UPI app
    await tx.insert(deposits).values({
      bookingId, mode, provider: mode === "declared" || mode === "p2p" ? null : "razorpay",
      feeOrderId: started.feeOrderId, mandateId: started.mandateId, blockValidUntil,
      amountPaise: bk.depositPaise,
    }).onConflictDoNothing();
  });
}

// ---------- fee received + block confirmed ----------
export async function confirmDeposit(p: { bookingId: string; fee: PaymentEvent; block: PaymentEvent | null }) {
  const [bk] = await db.select().from(bookings).where(eq(bookings.id, p.bookingId));
  const [d] = await db.select().from(deposits).where(eq(deposits.bookingId, bk.id));
  if (p.fee.kind !== "fee") throw invalid("expected fee event");
  if (p.fee.amountPaise != null && p.fee.amountPaise !== bk.feePaise + bk.platformFeePaise)
    throw invalid(`fee mismatch: got ${p.fee.amountPaise}`);
  if (d.mode === "upi_block" && (p.block?.kind !== "deposit_block" || p.block.mandateId !== d.mandateId))
    throw invalid("deposit block not confirmed");

  let feeTransferId: string | null = null;
  if (p.fee.paymentId && d.provider) {                  // Phase 2: hold lender's fee until return handshake
    const lender = await lenderPayoutInfo(bk.lenderId);
    feeTransferId = (await payments(d.mode).transferToLender({ paymentId: p.fee.paymentId,
      accountId: lender.routeAccountId!, amountPaise: bk.feePaise, onHold: true,
      idempotencyKey: `booking:${bk.id}:fee` })).transferId;
  }
  await db.transaction(async (tx) => {
    await tx.update(deposits).set({
      feePaymentId: p.fee.kind === "fee" ? p.fee.paymentId : null,
      feeUtr: p.fee.kind === "fee" ? p.fee.utr : null,
      feeTransferId,
      status: d.mode === "declared" ? "pending" : "blocked",
      updatedAt: new Date(),
    }).where(eq(deposits.bookingId, bk.id));
    await transition({ tx, bookingId: bk.id, from: "ACCEPTED", to: "DEPOSIT_HELD", actorId: null,
                       reason: "upi_fee_and_deposit_secured", data: { mode: d.mode } });
  });
}

// ---------- evidence: presign ----------
export async function presignInspectionMedia(i: {
  bookingId: string; userId: string; phase: "handover" | "return"; slot: string;
  mime: string; bytes: number; sha256: string; geo: { lat: number; lng: number; accuracyM: number; capturedAt: string };
}) {
  const [bk] = await db.select().from(bookings).where(eq(bookings.id, i.bookingId));
  partyOf(bk, i.userId);
  const ext = i.mime === "video/mp4" ? "mp4" : i.mime === "image/heic" ? "heic" : "jpg";
  const key = `evidence/${bk.id}/${i.phase}/${i.userId}/${crypto.randomUUID()}.${ext}`;
  const [m] = await db.insert(inspectionMedia).values({
    bookingId: bk.id, uploaderId: i.userId, phase: i.phase, slot: i.slot, r2Key: key, mime: i.mime,
    bytes: i.bytes, sha256Client: i.sha256, lat: i.geo.lat, lng: i.geo.lng, accuracyM: i.geo.accuracyM,
    clientCapturedAt: new Date(i.geo.capturedAt),
  }).returning({ id: inspectionMedia.id });
  // presignUpload signs Content-Type + Content-Length + x-amz-checksum-sha256, so R2 itself rejects
  // a different file than the one hashed on the device.
  return { mediaId: m.id, uploadUrl: await presignUpload(key, { contentType: i.mime, bytes: i.bytes, sha256Hex: i.sha256 }) };
}

// ---------- evidence: finalize (server re-hash; never trust the client hash alone) ----------
export async function finalizeInspectionMedia(i: { bookingId: string; mediaId: string; userId: string }) {
  const [m] = await db.select().from(inspectionMedia)
    .where(and(eq(inspectionMedia.id, i.mediaId), eq(inspectionMedia.bookingId, i.bookingId)));
  if (!m || m.uploaderId !== i.userId) throw forbidden("not your upload");
  if (m.status === "verified") return { ok: true };
  const { buffer } = await getObject(m.r2Key);
  const serverHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const ok = serverHash === m.sha256Client;
  await db.update(inspectionMedia)
    .set({ sha256Server: serverHash, receivedAt: new Date(), status: ok ? "verified" : "rejected" })
    .where(eq(inspectionMedia.id, m.id));
  if (!ok) throw invalid("upload does not match device hash — retake photo");
  return { ok: true };
}

// ---------- two-party inspection ----------
export type InspectionInput = {
  actorId: string; phase: "handover" | "return"; mediaIds: string[];
  checklistAnswers: Record<string, { ok?: boolean; value?: string | number; note?: string }>;
  geo: { lat: number; lng: number; accuracyM: number; capturedAt: string };
};

export async function recordInspection(i: InspectionInput & { bookingId: string }) {
  const [bk] = await db.select().from(bookings).where(eq(bookings.id, i.bookingId));
  const party = partyOf(bk, i.actorId);
  const [soc] = await db.select().from(societies).where(eq(societies.id, bk.societyId));

  // All required slots present, verified, uploaded by this party, for this phase.
  const media = await db.select().from(inspectionMedia).where(inArray(inspectionMedia.id, i.mediaIds));
  if (media.some((m) => m.uploaderId !== i.actorId || m.phase !== i.phase || m.bookingId !== bk.id))
    throw forbidden("media does not belong to this inspection");
  if (media.some((m) => m.status !== "verified")) throw invalid("some photos are not finalized");
  const required = bk.photoSlotsSnapshot as string[];
  const missing = required.filter((s) => !media.some((m) => m.slot === s));
  if (missing.length) throw invalid(`missing photos: ${missing.join(", ")}`);

  // Every checklist item answered.
  const items = bk.checklistSnapshot as { id: string }[];
  const unanswered = items.filter((it) => !(it.id in i.checklistAnswers));
  if (unanswered.length) throw invalid(`checklist incomplete: ${unanswered.map((u) => u.id).join(", ")}`);

  const dist = haversineM(i.geo.lat, i.geo.lng, soc.centerLat, soc.centerLng);
  const within = dist <= soc.radiusM + Math.min(i.geo.accuracyM, 100);

  await db.transaction(async (tx) => {
    const [ins] = await tx.insert(inspections).values({
      bookingId: bk.id, phase: i.phase, party, submittedBy: i.actorId, checklistAnswers: i.checklistAnswers,
      lat: i.geo.lat, lng: i.geo.lng, accuracyM: i.geo.accuracyM, withinGeofence: within,
      clientCapturedAt: new Date(i.geo.capturedAt),
    }).onConflictDoNothing().returning({ id: inspections.id });       // one per (booking, phase, party)
    if (!ins) throw invalid("inspection already submitted");
    await tx.update(inspectionMedia).set({ inspectionId: ins.id }).where(inArray(inspectionMedia.id, i.mediaIds));
  });
  return { party, withinGeofence: within };
}

// ---------- complete: release the UPI block (nothing to refund), release lender fee ----------
export async function complete({ bookingId, auto }: { bookingId: string; auto: boolean }) {
  const [d] = await db.select().from(deposits).where(eq(deposits.bookingId, bookingId));
  const pg = payments(d.mode);
  if (d.mode === "upi_block" && d.status === "blocked") {
    await pg.releaseDeposit({ bookingId, mandateId: d.mandateId!, idempotencyKey: `booking:${bookingId}:release` });
  }
  // capture_refund: pg.releaseDeposit refunds instead. p2p: opens a "refund to borrower's VPA" task for the
  // lender (UPI intent link) with a 24 h timer in a child workflow. declared: no-op.
  if (d.feeTransferId) await pg.releaseTransferHold(d.feeTransferId);
  await db.transaction(async (tx) => {
    await tx.update(deposits).set({ status: "released", updatedAt: new Date() }).where(eq(deposits.bookingId, bookingId));
    await transition({ tx, bookingId, from: "RETURN_PENDING", to: "COMPLETED", actorId: null,
                       reason: auto ? "auto_accept_24h" : "lender_agreed" });
  });
}

// ---------- dispute open + settle ----------
export type DisputeInput = { actorId: string; category: string; description: string; claimedPaise: number; mediaIds: string[] };

export async function openDispute(i: DisputeInput & { bookingId: string }) {
  const [bk] = await db.select().from(bookings).where(eq(bookings.id, i.bookingId));
  partyOf(bk, i.actorId);
  if (i.claimedPaise > bk.depositPaise) throw invalid("claim cannot exceed the held deposit");
  return db.transaction(async (tx) => {
    const [dp] = await tx.insert(disputes).values({
      bookingId: bk.id, raisedBy: i.actorId, category: i.category, description: i.description,
      claimedPaise: i.claimedPaise,
    }).returning({ id: disputes.id });
    await transition({ tx, bookingId: bk.id, from: ["HANDOVER_PENDING", "ACTIVE", "OVERDUE", "RETURN_PENDING"],
                       to: "DISPUTED", actorId: i.actorId, reason: `dispute_${i.category}`, data: { disputeId: dp.id } });
    return { disputeId: dp.id };
  });
}

export type RulingInput = { actorId: string; awardPaise: number; note: string };

export async function settleDispute(i: RulingInput & { bookingId: string }) {
  const [bk] = await db.select().from(bookings).where(eq(bookings.id, i.bookingId));
  const [d] = await db.select().from(deposits).where(eq(deposits.bookingId, bk.id));
  const [dp] = await db.select().from(disputes).where(eq(disputes.bookingId, bk.id));
  if (i.awardPaise > Math.min(dp.claimedPaise, d.amountPaise)) throw invalid("award exceeds claim/deposit");
  const pg = payments(d.mode);

  let status: typeof d.status = "released";
  let debitPaymentId: string | null = null;
  if (i.awardPaise > 0) {
    if (d.mode === "upi_block" && d.status === "blocked") {
      // Debit ONLY the award from the block; the rest stays in the borrower's account.
      try {
        debitPaymentId = (await pg.debitDeposit({ bookingId: bk.id, mandateId: d.mandateId!,
          amountPaise: i.awardPaise, idempotencyKey: `booking:${bk.id}:award` })).paymentId;
        const lender = await lenderPayoutInfo(bk.lenderId);
        await pg.transferToLender({ paymentId: debitPaymentId, accountId: lender.routeAccountId!,
          amountPaise: i.awardPaise, onHold: false, idempotencyKey: `booking:${bk.id}:award-transfer` });
        status = i.awardPaise === d.amountPaise ? "debited" : "partially_debited";
      } catch (e) {
        if (!isPermanentDebitFailure(e)) throw e;  // retryable → Temporal retries with the same idempotency key
        status = "debt_recorded";                   // account closed / block revoked → becomes a profile debt
      }
    } else {
      status = "debt_recorded";                     // declared / p2p: borrower pays lender via UPI intent, lender confirms
    }
  }
  if (d.mode === "upi_block" && status !== "debited") {
    // Free whatever is left of the block (after a partial debit, or on a ₹0 award).
    await pg.releaseDeposit({ bookingId: bk.id, mandateId: d.mandateId!, idempotencyKey: `booking:${bk.id}:release` });
  }
  if (d.feeTransferId) await pg.releaseTransferHold(d.feeTransferId);   // lender still earns the rental fee

  await db.transaction(async (tx) => {
    await tx.update(deposits).set({
      debitedPaise: status === "debt_recorded" ? 0 : i.awardPaise, debitPaymentId, status, updatedAt: new Date(),
    }).where(eq(deposits.bookingId, bk.id));
    await tx.update(disputes).set({
      status: "resolved", arbiterId: i.actorId, awardPaise: i.awardPaise, rulingNote: i.note, resolvedAt: new Date(),
    }).where(eq(disputes.id, dp.id));
    await transition({ tx, bookingId: bk.id, from: "DISPUTED", to: "RESOLVED", actorId: i.actorId,
                       reason: "arbiter_ruling", data: { awardPaise: i.awardPaise, depositOutcome: status } });
  });
}

export async function validateArbiter({ bookingId, arbiterId }: { bookingId: string; arbiterId: string }) {
  const [bk] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (arbiterId === bk.lenderId || arbiterId === bk.borrowerId) throw forbidden("parties cannot arbitrate");
  if (!(await isSocietyAdminOrPlatform(arbiterId, bk.societyId))) throw forbidden("not an arbiter for this society");
  if (await sharesUnitWithParty(arbiterId, bk)) throw forbidden("arbiter lives in a party's flat");
}

// (helpers assertApprovedMember, priceFor, isExclusionViolation, lenderRouteAccount,
//  isSocietyAdminOrPlatform, sharesUnitWithParty, expire, activate, markOverdue, nudgeOverdue,
//  escalateDispute, recomputeTrust, recordAck … follow the same pattern)
```

Notes on correctness:

* **Money moves before the DB transition, with idempotency keys.** If the transition then fails, Temporal retries the activity; the gateway sees the same idempotency key and returns the original mandate debit/transfer instead of debiting twice. (*Verify that Razorpay mandate debits/Transfers honour an idempotency key for our account; if not, look up existing payments by `notes.booking_id` before creating.*)
* `deposit_conserved` CHECK constraint makes "debited > blocked deposit" impossible at the DB level.
* The `EXCLUDE USING gist` constraint makes double-booking impossible regardless of app races.
* Webhook duplicates are a no-op via `payment_webhook_events` PK; workflow ignores a second fee/block event because `fee ??=` / `block ??=` keep the first.
* Nightly **reconciliation** activity (Temporal schedule, like RentVault's `schedules.ts`): compare `deposits` rows with Razorpay UPI payments, mandates (blocks still active after COMPLETED = bug) and transfers; any mismatch pages ntfy.

---

## 8. Ops checklist (per org conventions)

- [ ] Follow `knowledge_base/launching-a-new-app.md` end to end
- [ ] Repo `3pandalabs/borrowvault` **public** from day one (Coolify public-repo source); main-branch ruleset
- [ ] DB `borrowvault` + role `borrowvault_app`, `ALTER SCHEMA public OWNER TO borrowvault_app` at creation (avoids the 42501 crash-loop); idempotent migrations; `MIGRATION_DATABASE_URL` unset; `btree_gist` extension created by superuser once
- [ ] Coolify: `borrowvault-api` + `borrowvault-worker` (Temporal task queue `borrowvault`); Postgres backup schedule → `borrowvault-backups` from day one (RsvpVault still hasn't)
- [ ] Dockerfile on **node:22-alpine** (avoid RsvpVault's Node-20 fuse)
- [ ] Hostnames all under `borrowvault.` first label; orange cloud except `api-internal` (grey, for Worker → API)
- [ ] `/metrics` endpoint + admin page table; Mermaid booking-flow diagram in `3pandalabs/admin`
- [ ] Mailer: needs its own verified sender — **Resend only holds one domain on the current plan** (adding one evicts `rsvpvault`). Use push notifications for Phase 1; solve mail sender before launch
- [ ] Uptime Kuma check + watchdog entry; error-burst alert already covers new containers
- [ ] Tech-stack.md Section 7 + memory entry once scaffolded

---

## 9. Legal / policy (India)

* T&Cs: platform is an **intermediary** (IT Act s.79 + 2021 Intermediary Rules → grievance officer contact, takedown process). Lender owns condition risk; deposit is the sole remedy on-platform.
* **DPDP Act 2023**: photos of people's homes/faces, phone numbers, proof documents are personal data — consent at onboarding, purpose-limited retention (180 days post-completion), deletion on request except open disputes.
* Prohibited categories: vehicles, weapons, medicines, anything needing a licence, personal-care items; baby car seats need an "accident history" disclosure.
* Governing law: 3PandaLabs contracts default to New Jersey, but consumer-facing India terms will likely need Indian jurisdiction once the Indian entity exists — get advice.
* Skill gigs: tutoring/pet-sitting by residents is informal income — platform takes no responsibility for licensing; food (home baking) above small scale needs FSSAI registration → show a disclaimer and a "has FSSAI no." field.

---

## 10. Phased plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Validate (2 wks)** | WhatsApp-group concierge in 1–2 societies Anil/Prachi have access to; Google Form listings | ≥ 30 listings, ≥ 15 rentals, ≥ 1 resolved condition disagreement |
| **1 — MVP, no gateway** | Society onboarding + admin approval, listings, booking state machine **with inspections and disputes**, UPI intent-link fee straight to lender (RentVault payLinks), deposit = "declared" (trust-score backed, admin arbitrated, no money held) | 1 society, 100 approved residents, < 5% disputes |
| **2 — Money** | Indian entity → Razorpay UPI (one-time mandate blocks for deposits, UPI collect for fees) + Route payouts; reconciliation | first ₹ moved end-to-end, zero reconciliation diffs for 30 days |
| **3 — Scale** | multi-society, RWA dashboard, MyGate/NBH partnership, skill gigs with scheduling, insurance partner for high-value items | 10 societies |

The state machine, inspections and dispute UI are **the product** — build them fully in Phase 1 even with no money behind them. The deposit is a later bolt-on through `DepositProvider`.

---

## 11. Open questions

1. Indian entity: incorporate now (Phase 2 dependency) or validate first? (Recommendation: validate first.)
2. Pilot society — which one, and who is the first society admin?
3. ~~Final name~~ — decided: BorrowVault (2026-10-30).
4. Phone OTP provider (needs Indian entity for DLT-registered SMS) vs. WhatsApp OTP vs. email-only in Phase 1.
5. Does the platform fee apply in Phase 1 (no gateway → can't collect it)? Likely free in Phase 1.
6. Resend single-domain constraint — upgrade plan or move mailer to Cloudflare Email Service?
