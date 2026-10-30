# BorrowVault API — route contract (Phase 1)

This file is the contract between `api/`, `web/` and `app/`. Change it first and the code second.

- Base URL: `https://api.borrowvault.3pandalabs.com` (dev: `http://localhost:8080`).
- JSON everywhere. Errors use the shape `{ "error": string, "code"?: string }`.
- Auth: `Authorization: Bearer <accessToken>` (JWT, 15 min). Refresh tokens rotate (same scheme as RsvpVault).
- Money is **integer paise**, field names end in `Paise`. Times are ISO-8601 UTC strings.
- Status codes: 400 validation · 401 unauthenticated · 403 wrong party/role · 404 not found **or not in your society** (never leak existence) · 409 state conflict (`code: "TRANSITION_CONFLICT"`, `"OVERLAP"`, `"ALREADY_SUBMITTED"`, `"CONFLICT"`). Domain errors also carry `code: "VALIDATION"|"FORBIDDEN"|"NOT_FOUND"`; `error` is a human-readable message. 409 `code: "WINDOW_PASSED"` when accepting or confirming payment at/after `endsAt`. 503 `code: "UNAVAILABLE"` when the booking workflow service (Temporal) is down. 429 `{error: "rate_limited"}` on auth routes. Rate-limit buckets key on `CF-Connecting-IP` (else the socket IP); `X-Client-IP` is honoured **only** with a matching `X-Internal-Secret` header (= `INTERNAL_SHARED_SECRET`, sent by the web Worker on api-internal). Login is also limited per email (10 / 15 min) and globally.
- **Approved membership:** new actions (create booking, accept, payment claim/confirm, create/patch listing) need an **approved** membership in that society: 403 `FORBIDDEN` for a party whose membership is pending/revoked (listing writes: 404). In-flight obligations (return inspection, ack, disputes, refunds, awards, ratings) stay open to a revoked party.
- **Idempotent actions:** repeating a state-changing booking action you already performed (same actor, same action) returns 200 with the current `BookingDetail` instead of 409.
- Society scoping: every resident-facing read is filtered to societies where the caller has an **approved** membership.

Phase 1 has **no payment gateway**. Rental fees (and optional P2P deposits) are paid through UPI intent links straight to the lender's VPA, and the lender confirms receipt.

## Auth / profile

| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | `/auth/signup` | – | `{email, password, displayName, phone}` → `{accessToken, refreshToken, user}` |
| POST | `/auth/login` | – | `{email, password}` → same |
| POST | `/auth/refresh` | – | `{refreshToken}` → same |
| POST | `/auth/logout` | ✓ | `{refreshToken}` → 204 always; the session is deleted only if the token verifies and belongs to the caller |
| POST | `/auth/password-reset/request` | – | `{email}` → 204 **always** (no account enumeration). Emails a link to `https://borrowvault.3pandalabs.com/reset-password?token=…` (`WEB_ORIGIN`; the web page handles it, the app just opens that URL) (30 min, single use). Same work (hashing) for unknown emails; mail is sent in the background. |
| POST | `/auth/password-reset/confirm` | – | `{token, password}` → 204 (kills all sessions); 400 `invalid_or_expired_token` |
| GET | `/me` | ✓ | → `{user, memberships: Membership[]}` |
| PATCH | `/me` | ✓ | `{displayName?, phone?, upiVpa?}` → `{user}`. `upiVpa` is validated as `^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$`; it is required before you can lend. |

`user = {id, email, displayName, phone, upiVpa|null, isPlatformAdmin, trust: {score, completed, disputesLost}}`

## Societies & membership

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/societies?q=` | – | Search live societies → `[{id, name, city}]` |
| GET | `/societies/:id/towers` | – | → `[{id, name}]` (used to pick a tower + flat number at join time) |
| POST | `/societies/:id/join` | ✓ | `{inviteCode?, towerId, flatNo, occupancy: "owner"\|"tenant"\|"family", proofKey?}` → `Membership` (status `pending`). A valid invite code for the tower records `via: "invite"`. The unit is created if missing. |
| POST | `/storage/presign` | ✓ | `{purpose: "proof"\|"listing_photo", mime, bytes}` → `{key, uploadUrl}` (proof ≤10 MB pdf/jpeg/png; listing photo ≤8 MB jpeg/png/webp) |
| GET | `/storage/url?key=` | ✓ | → `{url}` (presigned GET; only the uploader, society admins of a related membership, or booking parties) |

`Membership = {id, societyId, societyName, towerName, flatNo, role: "resident"|"society_admin", status: "pending"|"approved"|"rejected"|"revoked", occupancy, createdAt}`

### Society admin (role `society_admin` in that society; platform admins too)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/societies/:id/memberships?status=pending` | → `[Membership & {user:{id,displayName,email,phone}, proofKey|null}]` |
| POST | `/admin/memberships/:id/approve` · `/reject` | `{note?}` → `Membership` |
| POST | `/admin/memberships/:id/revoke` | → `Membership` |
| POST | `/admin/societies/:id/towers` | `{name}` → tower |
| GET | `/admin/societies/:id` | → `Society` (for the settings form) |
| POST | `/admin/societies/:id/invite-codes` | `{towerId}` → `{code, expiresAt}` (8 chars, 30 days) |
| GET | `/admin/societies/:id/invite-codes` | → `[{code, towerId, towerName, expiresAt, usedCount}]` (newest first) |
| PATCH | `/admin/societies/:id` | `{centerLat?, centerLng?, radiusM?, settings?}` (`settings.depositMode: "declared"\|"p2p"`) |
| GET | `/admin/societies/:id/disputes?status=open\|resolved` | → `[Dispute & {booking: Booking}]` (`open` = any unresolved status; any exact `Dispute.status` value also works; `booking.myRole` is `"admin"`) |

`Society = {id, name, city, centerLat, centerLng, radiusM, settings: {depositMode: "declared"|"p2p"}, status}`

### Platform admin (`users.is_platform_admin`)

| POST | `/platform/societies` | `{name, city, centerLat, centerLng, radiusM, adminUserEmail}` → `Society` (status `live`); makes that (already signed-up) user an approved `society_admin`; 400 if no such user |
| GET | `/platform/societies` | → `Society[]` (all statuses). Non-platform-admins get 403. |

## Listings

| Method | Path | Notes |
|---|---|---|
| GET | `/listings?societyId=&kind=&category=&q=&ownerId=me` | approved members of that society only → `ListingSummary[]` (status `active`). No `societyId` = all my approved societies. `ownerId=me` = my own listings across societies, **any status**. |
| GET | `/listings/:id` | → `Listing`. Owner always; others must be approved members of its society (404 otherwise; archived = 404 to non-owners). |
| POST | `/listings` | `{societyId, kind: "item"\|"skill", category, title, description, hourlyPaise?, dailyPaise?, weekendPaise?, depositPaise, replacementValuePaise?, checklistTemplate: ChecklistItem[], requiredPhotoSlots: string[], photoKeys: string[]}` → 201 `Listing`. At least one price is required. `category` must be a `/categories` key whose `kind` matches. For items, `requiredPhotoSlots` needs ≥1 slot. For skills the server **forces** deposit 0 and empty checklist/slots. `photoKeys` must be your own `listing_photo` uploads. Requires `upiVpa` on the profile (400 otherwise). |
| PATCH | `/listings/:id` | owner only (403 for other members); same fields (all optional) + `status: "active"\|"paused"\|"archived"` → `Listing`. Existing bookings keep their frozen snapshots. |
| GET | `/listings/:id/availability?from=&to=` | → `[{startsAt, endsAt}]` busy ranges (default window: now → +90 days) |
| GET | `/categories` | public → presets `[{key, label, kind, checklistTemplate, requiredPhotoSlots}]`: items `power_tools camera camping baby party kitchen sports`, skills `baking tutoring pet_sitting home_assembly` |

`ChecklistItem = {id, label, type: "bool"|"percent"|"choice"|"count"|"text", options?: string[]}` (`id` matches `^[a-z0-9_]{1,40}$`; `choice` needs ≥2 options)

`ListingSummary = {id, societyId, kind, category, title, hourlyPaise, dailyPaise, weekendPaise, depositPaise, status, coverUrl: string|null, owner: PartyInfo}`

`Listing = ListingSummary & {description, replacementValuePaise, checklistTemplate, requiredPhotoSlots, photoKeys, photoUrls, createdAt, updatedAt}`. `coverUrl`/`photoUrls` are presigned GETs (10 min), `photoUrls` in the same order as `photoKeys`. Listing photos are shown through these URLs, not through `/storage/url`.

## Bookings (state machine: see infra/blueprint.md §5)

`state ∈ REQUESTED ACCEPTED DEPOSIT_HELD HANDOVER_PENDING ACTIVE OVERDUE RETURN_PENDING COMPLETED DISPUTED RESOLVED DECLINED EXPIRED CANCELLED`

**Response convention:** every `POST /bookings/:id/...` action below returns the fresh `BookingDetail` (status 200) unless another shape is stated. State-changing actions run as Temporal workflow updates, so the response already reflects the new state.

| Method | Path | Who | Effect |
|---|---|---|---|
| POST | `/bookings` | borrower | `{listingId, startsAt, endsAt, pricing: "hourly"\|"daily"\|"weekend"}` → 201 `Booking` (REQUESTED). 409 `OVERLAP` if busy. Fee: hourly = ceil(hours)×rate, daily = ceil(24 h days)×rate, weekend = flat. Max 30 days. 403 if the borrower has an unpaid dispute award or trust < 2.0. Weekend pricing: the booking must start no earlier than Fri 12:00 IST and end no later than Mon 12:00 IST of the same weekend (else 400). |
| GET | `/bookings?role=lender\|borrower&state=` | ✓ | → `Booking[]` |
| GET | `/bookings/:id` | party, or society/platform admin if DISPUTED/RESOLVED | → `BookingDetail` |
| POST | `/bookings/:id/accept` | lender | → ACCEPTED; `payment` is now populated. 409 `OVERLAP` if another booking took the slot. 400 if the lender has no `upiVpa`. Requires an approved membership and an `active` listing (409 `CONFLICT` otherwise); 409 `WINDOW_PASSED` once `now >= endsAt`. |
| POST | `/bookings/:id/decline` | lender | → DECLINED |
| POST | `/bookings/:id/cancel` | either party | allowed before ACTIVE → CANCELLED. If the lender had already confirmed payment, a refund is owed: `payment.refundDuePaise` = fee (declared) or fee + deposit (p2p), `refundUpiIntent` to the borrower, `nextAction` `refund_deposit` (lender) / `confirm_refund` (borrower), and the 24 h refund timer runs (see Timers). |
| POST | `/bookings/:id/payment/claim` | borrower | `{utr?}`: "I've paid via UPI" (ACCEPTED only, no state change) Approved membership required. |
| POST | `/bookings/:id/payment/confirm` | lender | "Received". Fee (+ P2P deposit if any) → DEPOSIT_HELD. A prior claim is not required. Approved membership required; 409 `WINDOW_PASSED` once `now >= endsAt`. |
| POST | `/bookings/:id/media/presign` | party | `{phase: "handover"\|"return"\|"dispute", slot, mime: "image/jpeg"\|"image/png"\|"video/mp4"\|"video/quicktime", bytes, sha256 (hex), geo?: {lat, lng, accuracyM, capturedAt}\|null}` → 201 `{mediaId, uploadUrl}`. PUT the file to `uploadUrl` with exactly that `Content-Type` and `Content-Length`. handover/return: jpeg, mp4 or quicktime (iOS). dispute: png also allowed (web uploads); slots free-form (e.g. `dispute-1`). Objection photos for an ack use slot `objection` in the ack's phase. `geo` null/absent = the device had no fix: stored as **no location** (`withinGeofence: false`, `noLocation: true`), **never rejected**. Slot matches `^[A-Za-z0-9_-]{1,40}# BorrowVault API — route contract (Phase 1)
| POST | `/bookings/:id/media/:mediaId/finalize` | uploader | Server re-hashes (SHA-256 + size). 400 if it doesn't match (media is then permanently rejected: retake). Idempotent. → `{ok: true}` The server copies the upload to an immutable `evidence-final/...` key that no presigned URL targets, verifies the hash **on that copy**, serves only it, and deletes the upload. Media URLs always point at the final copy. |
| POST | `/bookings/:id/inspections` | party | `{phase, mediaIds, checklistAnswers: {[itemId]: {ok?, value?, note?}}, geo: {lat, lng, accuracyM, capturedAt}\|null}` → `Inspection`. `geo: null` = no fix: stored as no location, `withinGeofence: false`, never rejected. Media must be your own finalized uploads for that phase; every `photoSlotsSnapshot` slot covered; every checklist item answered. handover: both parties, HANDOVER_PENDING. return: **borrower only** (ACTIVE/OVERDUE → RETURN_PENDING); the lender gets 403 and reviews via `/inspections/ack`. Skills: `mediaIds: []`, `checklistAnswers: {}`. Re-submitting the same phase returns 200 with the existing inspection (idempotent; the first submission stands). |
| POST | `/bookings/:id/inspections/ack` | counter-party | `{phase, result: "agreed"\|"objected", note?, mediaIds?: string[]}` acks the OTHER party's inspection. `mediaIds` (≤5) = the acker's own finalized uploads for that phase with slot `objection`; returned in `Inspection.ack.media`. handover: borrower `agreed` on the lender's (with both submitted) → ACTIVE. return: lender `agreed` → COMPLETED; `objected` keeps RETURN_PENDING and the lender must raise a dispute within the same 24 h window. Repeating the same result is idempotent (200); a different result after acking is 409 `ALREADY_SUBMITTED`. |
| POST | `/bookings/:id/disputes` | party | `{category: "damage"\|"missing_part"\|"not_returned"\|"not_as_described"\|"late", description (10-2000), claimedPaise, mediaIds?}` → DISPUTED. From HANDOVER_PENDING/ACTIVE/OVERDUE/RETURN_PENDING. `mediaIds` = your finalized `dispute`-phase media. Claim cap: `max(depositPaise, replacementValuePaise ?? 0)` using the **booking's** `replacementValuePaise` (snapshot at creation; clients compute the cap from the booking, never the live listing); a borrower may alternatively claim up to fee + deposit. Awards can exceed the deposit: in p2p the lender keeps up to the deposit they hold (`awardFromDepositPaise`) and the excess is a debt; in declared mode the whole award is a debt. Debts settle via `award/paid-claim` → `paid-confirm`. |
| POST | `/bookings/:id/disputes/respond` | other party | `{responseText, offerPaise?}` (offer ≤ claim; once) |
| POST | `/bookings/:id/disputes/accept-offer` | raiser | settles at `offerPaise` → RESOLVED |
| POST | `/bookings/:id/disputes/ruling` | society admin (not a party, not same unit) or platform admin | `{awardPaise ≤ claimedPaise, note}` → RESOLVED |
| POST | `/bookings/:id/deposit/refund-claim` | lender | "I've refunded": any refund owed (p2p deposit after COMPLETED, or fee/+deposit after a paid CANCELLED) |
| POST | `/bookings/:id/deposit/refund-confirm` | borrower | "Refund received" (stops the 24 h timer). 409 while a dispute is open; the ruling decides what is still owed (net of any refund already confirmed). |
| POST | `/bookings/:id/award/paid-claim` · `/award/paid-confirm` | award payer · award payee | settles an award recorded as debt. The payer is the party who did NOT raise the dispute (usually the borrower, but the lender when the borrower won). See `payment.awardPayerId`. |
| POST | `/bookings/:id/ratings` | party, after COMPLETED/RESOLVED | `{stars 1-5, punctual?, careful?, asDescribed?, comment?}` → 201 `{id, bookingId, rateeId, stars, punctual, careful, asDescribed, comment, createdAt}`. Once per party (409 `ALREADY_SUBMITTED`). |

`Booking = {id, state, listing: {id, title, kind, category}, lender: PartyInfo, borrower: PartyInfo, startsAt, endsAt, pricing, feePaise, depositPaise, replacementValuePaise: number|null, platformFeePaise (0 in Phase 1), myRole: "lender"|"borrower"|"admin", nextAction: string|null, deadlineAt: string|null}`

`PartyInfo = {id, displayName, towerName, flatNo, trust}`

`BookingDetail = Booking & {society: {id, name, centerLat, centerLng, radiusM}, checklistSnapshot, photoSlotsSnapshot, payment: Payment|null, inspections: Inspection[], dispute: Dispute|null, events: [{fromState, toState, reason, at}]}`

`Payment = {depositMode: "declared"|"p2p", feePaise, depositPaise, feeUpiIntent: string, depositUpiIntent: string|null, refundUpiIntent: string|null, awardUpiIntent: string|null, claimedAt, confirmedAt, utr, depositStatus: "none"|"pending"|"declared"|"held_by_lender"|"refund_claimed"|"refunded"|"released", refundDuePaise, refundClaimedAt, refundConfirmedAt, awardPaise, awardFromDepositPaise, awardStatus: "none"|"debt_recorded"|"settled_from_deposit"|"paid_claimed"|"paid", awardPayerId, awardPayeeId}`. `null` until the lender accepts. p2p + lender wins: up to the deposit is kept by the lender (`awardFromDepositPaise`) and `refundDuePaise` = deposit − that. Any excess makes `awardStatus: "debt_recorded"` with `awardUpiIntent` for `awardPaise − awardFromDepositPaise`; otherwise `awardStatus` is `settled_from_deposit`.

UPI intent format: `upi://pay?pa=<vpa>&pn=<urlencoded name>&am=<rupees with 2 decimals>&cu=INR&tn=<urlencoded "BV-<first 8 of booking id> <purpose>">`, purpose ∈ `rental fee` · `deposit` · `deposit refund` · `dispute award`.

`Inspection = {id, phase, party: "lender"|"borrower", checklistAnswers, withinGeofence, noLocation, submittedAt, media: Media[], ack: {result, note, at, media: Media[]}|null}`

`Media = {id, slot, url (presigned GET, 10 min), mime, receivedAt, withinGeofence, noLocation, clockSkewFlag}`

`Dispute = {id, raisedBy: userId | "system", raisedBySystem, category, description, claimedPaise, responseText, offerPaise, status, awardPaise, rulingNote, resolvedAt, createdAt, escalatedAt, deadlineAt, media?}`. `raisedBy` is `"system"` for the auto-raised p2p refund dispute (on the borrower's behalf). `media` (in `BookingDetail` only) = the dispute evidence, `Media[]`. `status ∈ open awaiting_response under_review escalated resolved withdrawn`.

`nextAction` values (so clients don't re-derive the state machine): `accept_or_decline`, `wait_lender`, `pay`, `confirm_payment`, `wait_payment`, `handover_inspect`, `handover_ack`, `wait_handover`, `return_inspect`, `review_return`, `wait_review`, `respond_dispute`, `wait_ruling`, `refund_deposit`, `confirm_refund`, `pay_award`, `confirm_award`, `rate`, `null`. `review_return` = the lender hasn't acked the borrower's return yet, OR objected and should now raise a dispute. `deadlineAt` = when the next timer fires if nobody acts.

## Timers (Temporal workflow `bookingWorkflow`, task queue `borrowvault`)

- REQUESTED: 12 h → EXPIRED
- ACCEPTED: 2 h without lender confirmation → EXPIRED
- DEPOSIT_HELD: at `startsAt − 1 h` → HANDOVER_PENDING (skills, which have no handover inspection, go straight on to ACTIVE)
- HANDOVER_PENDING: `startsAt + 24 h` → CANCELLED (lender no-show: a trust strike, −0.3 per no-show in 12 months). If payment was confirmed, a refund is owed exactly as for a cancel.
- ACTIVE: at `max(endsAt, activatedAt + 1 h)` → OVERDUE (a late handover still gets an hour, and an OVERDUE caused by a late handover carries no trust penalty), with nudges at +1/+6/+24 h and an admin alert at +48 h after going overdue. `deadlineAt` for ACTIVE uses the same clock.
- RETURN_PENDING: 24 h of lender silence → COMPLETED. An `objected` ack with no dispute raised in that window also auto-completes.
- DISPUTED: 72 h → escalated (platform admin notified)
- Refund owed (p2p deposit after COMPLETED, or fee/+deposit after a paid CANCELLED): 24 h without `refund-confirm` → auto dispute (`category: "late"`, `raisedBy: "system"` on behalf of the borrower; COMPLETED/CANCELLED → DISPUTED is a system-only move). Its ruling's `awardPaise` = the amount the lender must still refund.

## Ops

| GET | `/health` | → `{ok: true, commit, startedAt}` |
| GET | `/metrics` | `Authorization: Bearer <METRICS_TOKEN>`. Uses the shared envelope; `collector.ts` is copied verbatim from evitevault; app key `"borrowvault"` |
