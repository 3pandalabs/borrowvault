# ShareVault API — route contract (Phase 1)

This file is the contract between `api/`, `web/` and `app/`. Change it first and the code second.

- Base URL: `https://api.sharevault.3pandalabs.com` (dev: `http://localhost:8080`).
- JSON everywhere. Errors use the shape `{ "error": string, "code"?: string }`.
- Auth: `Authorization: Bearer <accessToken>` (JWT, 15 min). Refresh tokens rotate (same scheme as RsvpVault).
- Money is **integer paise**, field names end in `Paise`. Times are ISO-8601 UTC strings.
- Status codes: 400 validation · 401 unauthenticated · 403 wrong party/role · 404 not found **or not in your society** (never leak existence) · 409 state conflict (`code: "TRANSITION_CONFLICT"`, `"OVERLAP"`, `"ALREADY_SUBMITTED"`).
- Society scoping: every resident-facing read is filtered to societies where the caller has an **approved** membership.

Phase 1 has **no payment gateway**. Rental fees (and optional P2P deposits) are paid through UPI intent links straight to the lender's VPA, and the lender confirms receipt.

## Auth / profile

| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | `/auth/signup` | – | `{email, password, displayName, phone}` → `{accessToken, refreshToken, user}` |
| POST | `/auth/login` | – | `{email, password}` → same |
| POST | `/auth/refresh` | – | `{refreshToken}` → same |
| POST | `/auth/logout` | ✓ | `{refreshToken}` → 204 |
| POST | `/auth/password-reset/request` · `/confirm` | – | as in RsvpVault |
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
| POST | `/admin/societies/:id/invite-codes` | `{towerId}` → `{code, expiresAt}` (8 chars, 30 days) |
| PATCH | `/admin/societies/:id` | `{centerLat?, centerLng?, radiusM?, settings?}` (`settings.depositMode: "declared"\|"p2p"`) |
| GET | `/admin/societies/:id/disputes?status=` | → `Dispute[]` with booking summary |

### Platform admin (`users.is_platform_admin`)

| POST | `/platform/societies` | `{name, city, centerLat, centerLng, radiusM, adminUserEmail}` → society (status `live`); makes that user an approved `society_admin` |

## Listings

| Method | Path | Notes |
|---|---|---|
| GET | `/listings?societyId=&kind=&category=&q=` | approved members of that society only → `ListingSummary[]` |
| GET | `/listings/:id` | → `Listing` (+ `owner: {id, displayName, towerName, flatNo, trust}`) |
| POST | `/listings` | `{societyId, kind: "item"\|"skill", category, title, description, hourlyPaise?, dailyPaise?, weekendPaise?, depositPaise, replacementValuePaise?, checklistTemplate: ChecklistItem[], requiredPhotoSlots: string[], photoKeys: string[]}`. At least one price is required. For items, `requiredPhotoSlots` needs ≥1 slot. For skills, deposit is 0 and checklist/slots are empty. Requires `upiVpa` on the profile. |
| PATCH | `/listings/:id` | owner only; same fields + `status: "active"\|"paused"\|"archived"` |
| GET | `/listings/:id/availability?from=&to=` | → `[{startsAt, endsAt}]` busy ranges |
| GET | `/categories` | → presets `[{key, label, kind, checklistTemplate, requiredPhotoSlots}]` |

`ChecklistItem = {id, label, type: "bool"|"percent"|"choice"|"count"|"text", options?: string[]}`

## Bookings (state machine: see infra/blueprint.md §5)

`state ∈ REQUESTED ACCEPTED DEPOSIT_HELD HANDOVER_PENDING ACTIVE OVERDUE RETURN_PENDING COMPLETED DISPUTED RESOLVED DECLINED EXPIRED CANCELLED`

| Method | Path | Who | Effect |
|---|---|---|---|
| POST | `/bookings` | borrower | `{listingId, startsAt, endsAt, pricing: "hourly"\|"daily"\|"weekend"}` → `Booking` (REQUESTED). 409 `OVERLAP` if busy. |
| GET | `/bookings?role=lender\|borrower&state=` | ✓ | → `Booking[]` |
| GET | `/bookings/:id` | party, or society admin if disputed | → `BookingDetail` |
| POST | `/bookings/:id/accept` | lender | → ACCEPTED; response includes `payment` |
| POST | `/bookings/:id/decline` | lender | → DECLINED |
| POST | `/bookings/:id/cancel` | either party | allowed before ACTIVE → CANCELLED |
| POST | `/bookings/:id/payment/claim` | borrower | `{utr?}`: "I've paid via UPI" |
| POST | `/bookings/:id/payment/confirm` | lender | "Received". Fee (+ P2P deposit if any) → DEPOSIT_HELD |
| POST | `/bookings/:id/media/presign` | party | `{phase: "handover"\|"return"\|"dispute", slot, mime: "image/jpeg"\|"video/mp4", bytes, sha256, geo: {lat, lng, accuracyM, capturedAt}}` → `{mediaId, uploadUrl}` |
| POST | `/bookings/:id/media/:mediaId/finalize` | uploader | Server re-hashes. 400 if the hash doesn't match. → `{ok: true}` |
| POST | `/bookings/:id/inspections` | party | `{phase, mediaIds, checklistAnswers: {[itemId]: {ok?, value?, note?}}, geo}` → `Inspection` |
| POST | `/bookings/:id/inspections/ack` | counter-party | `{phase, result: "agreed"\|"objected", note?}` |
| POST | `/bookings/:id/disputes` | party | `{category: "damage"\|"missing_part"\|"not_returned"\|"not_as_described"\|"late", description, claimedPaise, mediaIds}` → DISPUTED |
| POST | `/bookings/:id/disputes/respond` | other party | `{responseText, offerPaise?}` |
| POST | `/bookings/:id/disputes/accept-offer` | raiser | settles at `offerPaise` → RESOLVED |
| POST | `/bookings/:id/disputes/ruling` | society admin (not a party, not same unit) or platform admin | `{awardPaise, note}` → RESOLVED |
| POST | `/bookings/:id/deposit/refund-claim` | lender (p2p mode) | "I've refunded the deposit" |
| POST | `/bookings/:id/deposit/refund-confirm` | borrower (p2p mode) | "Refund received" |
| POST | `/bookings/:id/award/paid-claim` · `/award/paid-confirm` | borrower · lender | settles an award recorded as debt |
| POST | `/bookings/:id/ratings` | party, after COMPLETED/RESOLVED | `{stars 1-5, punctual?, careful?, asDescribed?, comment?}` |

`Booking = {id, state, listing: {id, title, kind, category}, lender: PartyInfo, borrower: PartyInfo, startsAt, endsAt, feePaise, depositPaise, platformFeePaise (0 in Phase 1), myRole: "lender"|"borrower"|"admin", nextAction: string|null, deadlineAt: string|null}`

`PartyInfo = {id, displayName, towerName, flatNo, trust}`

`BookingDetail = Booking & {checklistSnapshot, photoSlotsSnapshot, payment: Payment|null, inspections: Inspection[], dispute: Dispute|null, events: [{fromState, toState, reason, at}]}`

`Payment = {depositMode: "declared"|"p2p", feeUpiIntent: string, depositUpiIntent: string|null, refundUpiIntent: string|null, awardUpiIntent: string|null, claimedAt, confirmedAt, utr, depositStatus}`

UPI intent format: `upi://pay?pa=<vpa>&pn=<urlencoded name>&am=<rupees with 2 decimals>&cu=INR&tn=<urlencoded "SV-<first 8 of booking id> <purpose>">`.

`Inspection = {id, phase, party, checklistAnswers, withinGeofence, submittedAt, media: [{id, slot, url (presigned GET, 10 min), mime, receivedAt}], ack: {result, note, at}|null}`

`Dispute = {id, raisedBy, category, description, claimedPaise, responseText, offerPaise, status, awardPaise, rulingNote, resolvedAt, deadlineAt}`

`nextAction` values (so clients don't re-derive the state machine): `accept_or_decline`, `wait_lender`, `pay`, `confirm_payment`, `wait_payment`, `handover_inspect`, `handover_ack`, `wait_handover`, `return_inspect`, `review_return`, `wait_review`, `respond_dispute`, `wait_ruling`, `refund_deposit`, `confirm_refund`, `pay_award`, `confirm_award`, `rate`, `null`.

## Timers (Temporal workflow `bookingWorkflow`, task queue `sharevault`)

- REQUESTED: 12 h → EXPIRED
- ACCEPTED: 2 h without lender confirmation → EXPIRED
- DEPOSIT_HELD: at `startsAt − 1 h` → HANDOVER_PENDING
- HANDOVER_PENDING: `startsAt + 24 h` → CANCELLED (lender no-show)
- ACTIVE: at `endsAt` → OVERDUE, with nudges at +1/+6/+24 h and an admin alert at +48 h
- RETURN_PENDING: 24 h of lender silence → COMPLETED
- DISPUTED: 72 h → escalated (platform admin notified)
- p2p deposit refund: 24 h after COMPLETED without `refund-confirm` → auto dispute (`category: "late"`, raised by system on behalf of the borrower)

## Ops

| GET | `/health` | → `{ok: true}` |
| GET | `/metrics` | `Authorization: Bearer <METRICS_TOKEN>`. Uses the shared envelope; `collector.ts` is copied verbatim from evitevault; app key `"sharevault"` |
