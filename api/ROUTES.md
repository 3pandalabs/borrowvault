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
| POST | `/auth/password-reset/confirm` | – | `{token, password}` → 204 (kills all sessions **and deletes all the user's push tokens**); 400 `invalid_or_expired_token` |
| GET | `/me` | ✓ | → `{user, memberships: Membership[]}` |
| PATCH | `/me` | ✓ | `{displayName?, phone?, upiVpa?, chatPushEnabled?: boolean}` → `{user}`. `upiVpa` is validated as `^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$`; it is required before you can lend. `chatPushEnabled: false` stops chat push notifications to all your devices (default `true`). |
| POST | `/me/push-tokens` | ✓ | `{token, platform: "ios"\|"android"}` → **204**. Registers this device for push. `token` must be an Expo push token matching `^Expo(nent)?PushToken\[[^\]\s]{1,200}\]$` (else 400 `VALIDATION`). Upsert on `token`: re-registering refreshes `last_seen_at`, and a token already registered to another user is **moved** to the caller (one device = one signed-in account). The app calls it on every app start and sign-in. Rate limited: 20 / hour per user → 429 `{error: "rate_limited"}`. |
| DELETE | `/me/push-tokens` | ✓ | `{token}` (JSON body, 1–300 chars) → **204** always. Unregisters that token if it belongs to the caller (someone else's token is left alone, still 204). The app calls it on sign-out, **before** `POST /auth/logout`. Rate limited: 30 / hour per user. |

`user = {id, email, displayName, phone, upiVpa|null, isPlatformAdmin, chatPushEnabled: boolean, trust: {score, completed, disputesLost}}`

There is no sign-out-everywhere route. Account deletion is below.

### Account deletion (Google Play: in-app path + web URL `https://borrowvault.3pandalabs.com/delete-account`)

| Method | Path | Auth | Body → Response |
|---|---|---|---|
| GET | `/me/deletion` | ✓ | → `{canDelete: boolean, blockers: DeletionBlocker[]}`. A preflight so clients can show what to finish first. Same checks as the delete itself. |
| POST | `/me/delete` | ✓ | `{password}` → **204**. The current password confirms it: wrong → 403 `{error: "wrong_password", code: "FORBIDDEN"}`. 409 `{error: "account_has_open_obligations", code: "CONFLICT", blockers: DeletionBlocker[]}` while anything below is open. Rate limited: 5 / 15 min per user → 429 `{error: "rate_limited"}`. The client signs out afterwards (its refresh token is already dead). |

`DeletionBlocker = {kind: "live_booking"|"open_dispute"|"unpaid_award"|"refund_owed", bookingId, listingTitle, state}`:

- `live_booking`: a booking where you are lender or borrower in `REQUESTED ACCEPTED DEPOSIT_HELD HANDOVER_PENDING ACTIVE OVERDUE RETURN_PENDING`. Finish it, or cancel/decline it while that is still allowed.
- `open_dispute`: a booking in `DISPUTED`.
- `unpaid_award`: a dispute award recorded as a debt (`awardStatus` `debt_recorded` or `paid_claimed`) where you are the payer **or** the payee. Settle it first.
- `refund_owed`: a refund still due on a `COMPLETED`/`CANCELLED`/`RESOLVED` booking (`refundDuePaise > 0`, not confirmed), either side.

What deletion does, in **one transaction** (after re-checking the blockers under a row lock on the user):

- **Anonymise the user row** (kept, because bookings, disputes, ratings and chat messages reference it): `displayName` → `"Deleted user"`, `email` → a unique tombstone `deleted+<userId>@deleted.invalid`, `phone` → `""`, `upiVpa` → null, password hash → an unusable value, `chatPushEnabled` → false, `isPlatformAdmin` → false, `deleted_at` → now.
- **Listings**: every listing not already `archived`/`removed` becomes `archived`; `photoKeys` are emptied on all of them.
- **Memberships**: every pending/approved membership becomes `revoked` (role `resident`, `admin_since` cleared), and `proof_key` is cleared on all of them.
- **Admin requests**: their own open requests are closed (`pending` → `withdrawn`, `nominated` → `declined`); nominations they made that are still open → `cancelled`. Document keys (`id_proof_key`, `residence_proof_key`, legacy keys) are cleared and `docs_purged_at` is set.
- **Deleted outright**: sessions (refresh tokens), password-reset tokens, push tokens, and every block row the user is on (either side).
- **Kept** (shared records with other residents, anonymised through the user row): bookings and their events, payments, inspections, disputes, ratings, conversations, messages (immutable: the sender just shows as "Deleted user"), and message/user/listing reports.
- **R2**: after the commit the server deletes the membership proof files, `admin-docs/` files and listing photos (best effort: the keys are already gone from the database, so nothing can serve them even if a delete fails). **Inspection evidence is kept** (write-once invariant, and the other party may still need it); it is linked only to the anonymised user row.

Afterwards: login with the old email → 401 `invalid_credentials` (no row has that email any more), refresh → 401, and the address can sign up again as a brand-new account. Access tokens already issued are refused at once by this API process (any authed route → 401 `{error: "account_deleted"}`) and expire within 15 minutes regardless. Nobody can block, report or start a new conversation or booking with a deleted account.

## Societies & membership

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/societies?q=` | – | Search live societies → `[{id, name, city, tier: "pilot"\|"verified", full: boolean}]`. `full` = a pilot society at its member cap (see "Pilot societies"), so the join UI can say so before the user applies. |
| GET | `/societies/:id/towers` | – | → `[{id, name}]` (used to pick a tower + flat number at join time) |
| POST | `/societies/:id/join` | ✓ | `{inviteCode?, towerId, flatNo, occupancy: "owner"\|"tenant"\|"family", proofKey?}` → `Membership` (status `pending`). A valid invite code for the tower records `via: "invite"`. The unit is created if missing. 409 `{error: "society_full", code: "CONFLICT"}` when the society is a pilot at its member cap. 409 `CONFLICT` while the caller already has a pending or approved membership there (so a re-submit never queues, or notifies, twice). The society's admins are notified (see "Join request notice"). |
| POST | `/storage/presign` | ✓ | `{purpose: "proof"\|"listing_photo"\|"admin_doc", mime, bytes}` → `{key, uploadUrl}` (proof ≤10 MB pdf/jpeg/png; listing photo ≤8 MB jpeg/png/webp; admin_doc ≤10 MB pdf/jpeg/png, key under `admin-docs/`). PUT the file to `uploadUrl` with exactly that `Content-Type` and `Content-Length` (URL valid 5 min). Every presign returns a fresh key; no route overwrites or deletes an upload. |
| GET | `/storage/url?key=` | ✓ | → `{url}` (presigned GET, 10 min; only the uploader, society admins of a related membership, or booking parties). `admin_doc` keys: **only the uploader and platform admins** (society admins get 404 like everyone else). |

`Membership = {id, societyId, societyName, societyTier: "pilot"|"verified", towerName, flatNo, role: "resident"|"society_admin", status: "pending"|"approved"|"rejected"|"revoked", occupancy, createdAt}`

### Join request notice

Every successful `POST /societies/:id/join` (a new request, or a re-application after a rejection/revocation) notifies **every approved `society_admin` of that society**, except the requester. Platform admins are not notified (they aren't asked to review residents). Best effort and **fire-and-forget**: it runs after the response and never delays or fails the join (still 201). Deleted accounts are skipped. A pending request can't be re-submitted (409 above), so there is no duplicate notice; a re-application only follows an admin's own decision. Only the requester's display name and tower/flat go out: no email, phone, occupancy or proof document.

- **Email** (one per admin), subject `<requester displayName> asked to join <society name>`, HTML and text parts. It names the requester, their tower and flat and the society, and asks the admin to check the proof and approve or decline. A button (HTML) and the raw URL (both parts) link to `<WEB_ORIGIN>/admin/<societyId>` (the Members tab with the pending filter is the default there).
- **Push** to every app device each admin has registered. `chatPushEnabled` doesn't apply (it only covers chat). Payload: `{title: "New join request", body: "<requester> (<tower>-<flat>) asked to join <society>. Tap to review.", data: {type: "join_request", societyId, membershipId}, sound: "default", channelId: "default"}`. Tapping it opens the app's join-requests screen (`/admin/join-requests`).
- **In the clients**: the pending count is the length of `GET /admin/societies/:id/memberships?status=pending`, summed over the societies the user admins (no new endpoint). The app adds it to the green Profile tab count (next to co-admin nominations) and shows a banner on the profile screen ("N residents waiting for approval") that opens the join-requests screen, where admins approve or decline with an optional note. The web shows it as a count badge on the "Society admin" header link. Both poll lightly (every 2 min while in the foreground) and refresh after a review; the app also refreshes when a join-request push arrives.

### Society admin (role `society_admin` in that society; platform admins too)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/societies/:id/memberships?status=pending` | → `[Membership & {user:{id,displayName,email,phone}, proofKey|null}]` |
| POST | `/admin/memberships/:id/approve` · `/reject` | `{note?}` → `Membership`. Approve: 409 `{error: "society_full", code: "CONFLICT"}` when a pilot society already has 50 approved memberships (admins included). |
| POST | `/admin/memberships/:id/revoke` | → `Membership` |
| GET | `/admin/societies/:id/admins` | → `SocietyAdmin[]` (read-only; same shape as the platform list) |
| POST | `/admin/societies/:id/towers` | `{name}` → tower |
| GET | `/admin/societies/:id` | → `Society` (for the settings form) |
| POST | `/admin/societies/:id/invite-codes` | `{towerId}` → `{code, expiresAt}` (8 chars, 30 days) |
| GET | `/admin/societies/:id/invite-codes` | → `[{code, towerId, towerName, expiresAt, usedCount}]` (newest first) |
| PATCH | `/admin/societies/:id` | `{centerLat?, centerLng?, radiusM?, settings?}` (`settings.depositMode: "declared"\|"p2p"`) |
| POST | `/admin/societies/:id/nominations` | `{membershipId, committeeRole? (2–60, default "Co-admin")}` → 201 `AdminRequest` (kind `nominate_admin`, status `nominated`). See "Co-admin nominations". |
| GET | `/admin/societies/:id/nominations` | → `AdminRequest[]`: this society's `nominate_admin` requests, all statuses, newest first, max 100. Runs the auto-approve check first. |
| GET | `/admin/societies/:id/disputes?status=open\|resolved` | → `[Dispute & {booking: Booking}]` (`open` = any unresolved status; any exact `Dispute.status` value also works; `booking.myRole` is `"admin"`) |

Society admins can't make anyone an admin directly (only an approved admin request or co-admin nomination does, see "Admin requests"), and can't remove one: `POST /admin/memberships/:id/reject` and `/revoke` answer 403 `{error: "admin_membership_platform_only", code: "FORBIDDEN"}` when the target membership has role `society_admin`, unless the caller is a platform admin. A society admin also still can't review their own membership.

`Society = {id, name, city, centerLat, centerLng, radiusM, settings: {depositMode: "declared"|"p2p"}, status, tier: "pilot"|"verified", verifiedAt: string|null, memberCount: number, createdAt}`. `memberCount` = approved memberships, admins included.

### Pilot societies

A society approved through a self-serve `new_society` request starts as a **pilot** (`tier: "pilot"`). It stays a pilot until a platform admin marks it verified (`POST /platform/societies/:id/verify`). There is no deadline and no automatic pause. Societies that existed before tiers, and societies created directly by platform staff, are `verified`.

While `tier = "pilot"`:

- **Members:** at most **50** approved memberships, admins included. Approving the 51st (`POST /admin/memberships/:id/approve`) → 409 `{error: "society_full", code: "CONFLICT"}`; joining a full pilot (`POST /societies/:id/join`) → the same 409. The check runs under a row lock on the society, so two concurrent approvals can't both take the last place. A co-admin nomination doesn't add a member (the nominee is already one).
- **Listing values:** `depositPaise` and `replacementValuePaise` are capped at **₹5,000 (500000 paise)** on `POST /listings` and `PATCH /listings/:id` → 400 `{error: "pilot_value_cap", code: "VALIDATION"}`. PATCH checks the cap only when it sets either value, so pausing or archiving always works.
- **Disputes:** society admins can't rule. `POST /bookings/:id/disputes/ruling` by a society admin → 403 `{error: "pilot_platform_rules", code: "FORBIDDEN"}`. Platform admins rule instead, under the same arbiter rule (not a party, not living in a party's unit). Platform admins are emailed when the dispute is raised (society admins are not asked to rule), and the usual 72 h escalation still runs.

Verifying lifts all three limits straight away; in-flight disputes can then be ruled by society admins too.

### Platform admin (`users.is_platform_admin`)

Every `/platform/*` route answers 403 `{error: "platform_admin_required", code: "FORBIDDEN"}` to anyone who isn't a platform admin.

| Method | Path | Notes |
|---|---|---|
| POST | `/platform/societies` | `{name, city, centerLat, centerLng, radiusM, adminUserEmail}` → `Society` (status `live`, tier `verified`: staff did the checks themselves); makes that (already signed-up) user an approved `society_admin` (no unit). 400 if no such user. Direct creation for platform staff only; **the normal path is a self-serve `new_society` admin request** (below). |
| GET | `/platform/societies` | → `Society[]` (all statuses), newest first. `createdAt` (age) and `memberCount` help decide when to verify a pilot. |
| POST | `/platform/societies/:id/verify` | no body → `Society` (tier `verified`, `verifiedAt` set). Lifts the pilot limits. 404 unknown society; 409 `{error: "already_verified", code: "CONFLICT"}`. The society's admins are emailed (best effort). |
| GET | `/platform/admin-requests?status=pending\|approved\|rejected\|withdrawn\|nominated\|declined\|cancelled` | default `pending` → `PlatformAdminRequest[]`. `pending` is oldest first (a review queue; it includes nominations the nominee has accepted); other statuses newest first. Max 200. Runs the nomination auto-approve check first. |
| POST | `/platform/admin-requests/:id/approve` | `{note?: string (≤1000), centerLat?, centerLng?, radiusM? (int 50–5000)}` → `PlatformAdminRequest` (status `approved`). The geofence overrides apply to `new_society` only (ignored for other kinds); without them the requester's proposed values are used. One transaction: **new_society** creates the society (status `live`, **tier `pilot`**, default settings = `declared` deposits), the tower `towerName`, the unit `flatNo` (uppercased), and an approved `society_admin` membership for the requester on that unit (so the admin is also a resident of their flat; occupancy as requested); `societyId` is then set on the request. **join_admin** and **nominate_admin** flip the requester's membership role to `society_admin` (same code path); 409 `{error: "membership_not_active", code: "CONFLICT"}` if that membership is no longer approved. **nominate_admin** also re-checks the nominator: 409 `{error: "nominator_not_admin", code: "CONFLICT"}` if they are no longer an approved admin there. 409 `{error: "not_pending", code: "CONFLICT"}` if the request isn't pending (e.g. withdrawn or reviewed concurrently). 404 unknown id. The requester is emailed (best effort). |
| POST | `/platform/admin-requests/:id/reject` | `{note: string (5–1000), required}` → `PlatformAdminRequest` (status `rejected`). 409 `not_pending`. The requester is emailed the note (best effort); for a nomination, the nominator too. |
| GET | `/platform/societies/:id/admins` | → `SocietyAdmin[]` (404 unknown society). |
| POST | `/platform/societies/:id/admins/:membershipId/revoke-admin` | `{note: string (5–1000), required}` → `SocietyAdmin[]` (the society's remaining admins). Demotes that membership to `resident`; it stays `approved`. 404 if the membership isn't in that society; 409 `{error: "not_admin", code: "CONFLICT"}` if it isn't an approved `society_admin`. Allowed even if it leaves the society with 0 admins: disputes then have no society arbiter, and they escalate to the platform after 72 h exactly as today (platform admins can always rule). The note is stored as the membership's review note and emailed to the person (best effort). |

`SocietyAdmin = {membershipId, user: {id, displayName, email, phone}, towerName: string|null, flatNo: string|null, since}`. `since` = when they became admin (ISO). Sorted oldest admin first. `towerName`/`flatNo` are null for admins created by direct `POST /platform/societies`.

## Admin requests (becoming a society admin)

Nobody becomes a `society_admin` without a request that carries **their own ID proof**. There is no exception: every path below needs an `idProofKey`. Three kinds:

- `new_society`: "register my society on BorrowVault and make me its admin". Any signed-in user. A platform admin approves it, and the society starts as a **pilot** (see "Pilot societies").
- `join_admin`: "make me an (additional) admin of a society I already live in". Needs an **approved** membership in that society. A platform admin approves it.
- `nominate_admin`: an existing society admin nominates a resident as co-admin; the nominee accepts by uploading their ID proof. Approved automatically 48 h later unless a platform admin rejects it first (see "Co-admin nominations").

Documents are uploaded first with `POST /storage/presign {purpose: "admin_doc"}` (pdf/jpeg/png, ≤10 MB), then their keys go in `docs`. Every key must be **the caller's own** `admin_doc` upload and the keys must be distinct (400 `VALIDATION` otherwise). Only the uploader and platform admins can ever open them.

| Doc | `new_society` | `join_admin` | `nominate_admin` (on accept) | What it is (UI guidance) |
|---|---|---|---|---|
| `idProofKey` | required | required | required | The person's own ID proof. Advise a **masked** Aadhaar (only the last 4 digits visible), PAN, passport or driving licence |
| `residenceProofKey` | required | not accepted (400) | not accepted (400) | Proof that the requester lives in the society: maintenance bill, rent agreement, allotment letter or electricity bill, showing the flat |

No RWA certificate or authorisation letter is asked for or accepted (400 if sent). Requests made before this change may still carry `rwaRegistrationKey`/`authorizationKey`; they are shown read-only.

| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | `/admin-requests` | ✓ | Body is discriminated on `kind` (`new_society` or `join_admin`; nominations are created with `POST /admin/societies/:id/nominations`) → 201 `AdminRequest` (status `pending`). Rate limited: 10 per hour per client IP (429 `{error: "rate_limited"}`). The platform admins are emailed (best effort). |
| GET | `/admin-requests/mine` | ✓ | → `AdminRequest[]`, newest first (all statuses), including nominations **of** the caller. Runs the nomination auto-approve check first. |
| POST | `/admin-requests/:id/withdraw` | ✓ | no body → `AdminRequest` (status `withdrawn`). Own requests only (404 otherwise); 409 `{error: "not_pending", code: "CONFLICT"}` if it isn't pending. A nominee who has accepted can withdraw this way too. |
| POST | `/admin-requests/:id/accept` | nominee | `{idProofKey, statement? (≤1000)}` → `AdminRequest` (status `pending`, `nomineeAcceptedAt` set, `autoApproveAt` = +48 h). 404 unless the caller is the nominee. 409 `{error: "not_nominated", code: "CONFLICT"}` unless the status is `nominated`. 409 `membership_not_active` if the nominee's membership is no longer approved. 400 if `idProofKey` isn't the caller's own `admin_doc` upload. Platform admins and the nominator are emailed (best effort). |
| POST | `/admin-requests/:id/decline` | nominee | no body → `AdminRequest` (status `declined`). 404 unless the caller is the nominee; 409 `not_nominated` unless the status is `nominated`. The nominator is emailed (best effort). |
| POST | `/admin-requests/:id/cancel` | nominator | no body → `AdminRequest` (status `cancelled`). Allowed while `nominated` or `pending`. 404 unless the caller is the nominator; 409 `not_pending` otherwise. The nominee is emailed (best effort). |

`new_society` body:

```
{kind: "new_society", societyName (2–120), city (2–80), address (5–500),
 centerLat (-90..90), centerLng (-180..180), radiusM (int 50–5000),
 towerName (1–60), flatNo (1–20), occupancy: "owner"|"tenant"|"family",
 committeeRole (2–60, e.g. "Resident", "Secretary", "Committee member"), statement? (≤1000),
 docs: {idProofKey, residenceProofKey}}
```

409 `{error: "request_pending", code: "CONFLICT"}` if the caller already has a pending `new_society` request (one at a time per user).

`join_admin` body:

```
{kind: "join_admin", societyId (uuid), committeeRole (2–60), statement? (≤1000),
 docs: {idProofKey}}
```

404 if the caller has no **approved** membership in that society (pending/revoked/none look the same: no existence leak). 409 `{error: "already_admin", code: "CONFLICT"}` if they're already its `society_admin`. 409 `{error: "request_pending", code: "CONFLICT"}` if they already have a pending `join_admin` request, or an open (`nominated`/`pending`) nomination, for that society.

String fields are trimmed. Withdrawn, rejected, declined or cancelled requests don't block a new one.

### Co-admin nominations

1. A society admin calls `POST /admin/societies/:id/nominations {membershipId}`. The caller needs an **approved `society_admin` membership** in that society (a platform admin without one gets 403 `society_admin_required`; a non-member gets 404). The target must be an approved membership of the same society:
   - 404 if `membershipId` isn't a membership of that society.
   - 400 `{error: "cannot_nominate_self", code: "VALIDATION"}` for your own membership.
   - 409 `{error: "nominee_not_approved", code: "CONFLICT"}` if it isn't approved.
   - 409 `already_admin` if it's already a `society_admin`.
   - 409 `request_pending` if that person already has an open nomination or a pending `join_admin` request for the society.

   The request is created with `requesterId` = the nominee, `nominatedBy` = the caller, status `nominated`. The nominee is told three ways. The email and push are best effort and fire-and-forget, so they never fail the 201:
   - **Email** with the subject `<nominator displayName> nominated you as a co-admin of <society name>`, in HTML and text parts. It names the nominator and the society and says in one line what a co-admin does (approves residents, issues invite codes, settles disputes). It says what to do next: accept by uploading their own ID proof, or decline. A button (HTML) and the raw URL (both parts) link to `<WEB_ORIGIN>/admin-requests`. It also says the nomination is approved automatically 48 h after accepting unless BorrowVault rejects it first.
   - **Push** to every app device the nominee has registered. `chatPushEnabled` doesn't apply, since it only covers chat. Payload: `{title: "You've been nominated as a co-admin", body: "<nominator> nominated you as a co-admin of <society>. Tap to review.", data: {type: "admin_nomination", requestId}, sound: "default", channelId: "default"}`. Tapping it opens the app's admin-requests screen.
   - **In the clients**: while `GET /admin-requests/mine` holds a row with `kind: "nominate_admin"` and `status: "nominated"` (rows in `/mine` always have the caller as requester, i.e. nominee), web and app show a green dot on Profile and a green banner on the profile screen ("<nominator> nominated you as a co-admin of <society>", with Review nomination). They also show a green count on "My admin requests" and put that nomination first on the admin-requests page in a highlighted card with Accept/Decline. There is no new endpoint, because `nominatedBy.displayName` and `societyName` are already in `AdminRequest`.
2. The nominee accepts (`/accept`: ID proof required, statement optional) or declines (`/decline`). Accepting moves it to `pending` and sets `autoApproveAt` = acceptance + **48 h**. No authorisation letter: the nominating admin's vouching replaces it.
3. While `pending`, a platform admin can approve early or reject (the usual `/platform/admin-requests/:id/approve|reject`). The nominator can cancel until it is approved.
4. At `autoApproveAt`, if it is still `pending`, it is **approved automatically**. Approval (manual or automatic) is idempotent and re-validates in one transaction: the request is still `pending`, the nominee still has an approved membership, and the nominator is still an approved admin of that society. Then the nominee's membership role becomes `society_admin`, exactly as for `join_admin`. If the automatic check finds the nominee or the nominator no longer eligible, the request is closed as `rejected` with a system `reviewNote` (`reviewedBy` null) and nobody is promoted.

**Timer.** The worker process (`borrowvault-worker`) sweeps due nominations every 5 minutes. As a backstop, every read that shows nominations or roles (`GET /admin-requests/mine`, `GET /platform/admin-requests`, `GET /admin/societies/:id/nominations`, `GET /admin/societies/:id/admins`, `GET /me`) runs the same idempotent check first, so a missed sweep is never a correctness problem.

```
AdminRequest = {
  id, kind: "new_society"|"join_admin"|"nominate_admin",
  status: "nominated"|"pending"|"approved"|"rejected"|"withdrawn"|"declined"|"cancelled",
  requesterId,                 // nominate_admin: the nominee
  societyId: string|null,      // join_admin / nominate_admin: always set. new_society: null until approved, then the new society's id
  societyName: string,         // the existing society's name, or the proposed name (new_society)
  proposedSociety: {name, city, address, centerLat, centerLng, radiusM, towerName, flatNo,
                    occupancy: "owner"|"tenant"|"family"} | null,   // new_society only, as submitted (approval overrides aren't reflected here)
  committeeRole, statement: string|null,
  docs: {idProofKey: string|null,          // null only on a nomination the nominee hasn't accepted
         residenceProofKey: string|null,   // new_society (null on requests made before it existed)
         rwaRegistrationKey: string|null, authorizationKey: string|null},   // legacy, read-only
  nominatedBy: {id, displayName} | null,   // nominate_admin only
  nomineeAcceptedAt: string|null, autoApproveAt: string|null,   // nominate_admin only
  reviewNote: string|null, reviewedAt: string|null,
  createdAt, updatedAt
}

PlatformAdminRequest = AdminRequest & {
  requester: {id, displayName, email, phone},
  society: {id, name, city, tier, memberCount} | null,   // the existing society (join_admin, nominate_admin, or new_society once approved)
  resultingTier: "pilot" | null,                        // new_society: the tier approval creates. Other kinds: null
  docUrls: {idProof?: string, residenceProof?: string, rwaRegistration?: string, authorization?: string}   // presigned GETs (10 min) for the docs present
}
```

The requester can open their own documents with `GET /storage/url?key=` (keys are in `docs`).

## Listings

| Method | Path | Notes |
|---|---|---|
| GET | `/listings?societyId=&kind=&category=&q=&ownerId=me` | approved members of that society only → `ListingSummary[]` (status `active`). No `societyId` = all my approved societies. Browse **leaves out** listings whose owner no longer has an approved membership in that listing's society (pending/revoked/rejected, or a deleted account), and listings of anyone the caller has blocked or who has blocked the caller. `ownerId=me` = my own listings across societies, **any status**. |
| GET | `/listings/:id` | → `Listing`. Owner always; others must be approved members of its society, and get 404 when the listing is `archived` or `removed`, its owner has no approved membership in that society, or either of you has blocked the other. |
| POST | `/listings` | `{societyId, kind: "item"\|"skill", category, title, description, hourlyPaise?, dailyPaise?, weekendPaise?, depositPaise, replacementValuePaise?, checklistTemplate: ChecklistItem[], requiredPhotoSlots: string[], photoKeys: string[]}` → 201 `Listing`. At least one price is required. `category` must be a `/categories` key whose `kind` matches. For items, `requiredPhotoSlots` needs ≥1 slot. For skills the server **forces** deposit 0 and empty checklist/slots. `photoKeys` must be your own `listing_photo` uploads. Requires `upiVpa` on the profile (400 otherwise). In a pilot society `depositPaise` and `replacementValuePaise` must be ≤ 500000 (400 `pilot_value_cap`). |
| PATCH | `/listings/:id` | owner only (403 for other members); same fields (all optional) + `status: "active"\|"paused"\|"archived"` → `Listing`. Existing bookings keep their frozen snapshots. Pilot value cap as for POST, checked when the patch sets `depositPaise` or `replacementValuePaise`. A listing an admin removed can't be edited or re-activated: 409 `{error: "listing_removed", code: "CONFLICT"}`. |
| POST | `/listings/:id/report` | `{reason: "prohibited_item"\|"misleading"\|"offensive"\|"scam"\|"other", details?: string (trimmed, ≤1000)}` → **201** `{id, status: "open", createdAt}`. Anyone who can see the listing (404 otherwise). 403 `{error: "cannot_report_own_listing", code: "FORBIDDEN"}` for the owner. 409 `{error: "already_reported", code: "CONFLICT"}` while your earlier report on it is still open. Goes to the society's admins (emailed, best effort, link `/admin/<societyId>/reports`). Rate limited: 20 / hour per user. |
| GET | `/listings/:id/availability?from=&to=` | → `[{startsAt, endsAt}]` busy ranges (default window: now → +90 days) |
| GET | `/categories` | public → presets `[{key, label, kind, checklistTemplate, requiredPhotoSlots}]`: items `power_tools camera camping baby party kitchen sports`, skills `baking tutoring pet_sitting home_assembly` |

`ChecklistItem = {id, label, type: "bool"|"percent"|"choice"|"count"|"text", options?: string[]}` (`id` matches `^[a-z0-9_]{1,40}$`; `choice` needs ≥2 options)

`ListingSummary = {id, societyId, kind, category, title, hourlyPaise, dailyPaise, weekendPaise, depositPaise, status: "active"|"paused"|"archived"|"removed", coverUrl: string|null, owner: PartyInfo}`

`Listing = ListingSummary & {description, replacementValuePaise, checklistTemplate, requiredPhotoSlots, photoKeys, photoUrls, removal: {note, removedAt} | null, createdAt, updatedAt}`. `removal` is set only when `status` is `removed` (only the owner can see a removed listing). `coverUrl`/`photoUrls` are presigned GETs (10 min), `photoUrls` in the same order as `photoKeys`. Listing photos are shown through these URLs, not through `/storage/url`.

### Admin takedown (status `removed`)

A society admin of the listing's society, or a platform admin, can take a listing down. It gets its own status, `removed` (not `archived` + a flag), so every "not archived" check treats it the same way: browse, detail, new conversations and new bookings all handle `removed` exactly like `archived`, and the owner can't flip it back (PATCH → 409 `listing_removed`). The owner still sees it in `ownerId=me` and on `GET /listings/:id`, with `removal.note`. **Live bookings on it continue**: they keep their frozen snapshots and every in-flight action works. Only *new* bookings, accepting a still-`REQUESTED` one, and new conversations are refused, as for an archived listing. The owner is emailed (best effort).

| Method | Path | Notes |
|---|---|---|
| POST | `/admin/listings/:id/remove` | `{note: string (trimmed, 5–1000)}` → `Listing` (status `removed`). 404 for non-members of the listing's society, 403 `society_admin_required` for a resident. Repeating it on a removed listing returns it unchanged (200). Every open report on the listing becomes `actioned`. |

## Users: blocking and reporting

**Who counts as related.** You can block or report a user only if you share a society with them (both of you have an **approved** membership in it) **or** you have a conversation or a booking with them. Anyone else, unknown ids and deleted accounts → 404. Your own id → 400 `{error: "cannot_block_self"|"cannot_report_self", code: "VALIDATION"}`.

| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | `/users/:id/block` | ✓ | no body → **201** `BlockedUser` (200 with the existing one if you had already blocked them). Rate limited: 30 / hour per user. |
| DELETE | `/users/:id/block` | ✓ | → **204** always (also when there was no block). |
| GET | `/me/blocks` | ✓ | → `BlockedUser[]` (the people **you** blocked), newest first. Who blocked you is never shown. |
| POST | `/users/:id/report` | ✓ | `{reason: "harassment"\|"spam"\|"scam"\|"inappropriate"\|"other", details?: string (trimmed, ≤1000)}` → **201** `{id, status: "open", createdAt}`. 409 `{error: "already_reported", code: "CONFLICT"}` while your earlier report on them is still open. Rate limited: 20 / hour per user. The report is filed under one society you share (a society where you both have approved memberships first, else the society of your newest conversation or booking with them). That society's admins **and** the platform admins are emailed (best effort, no content; link `/admin/<societyId>/reports`). |

`BlockedUser = {user: {id, displayName}, createdAt}`

**What a block does (either direction: A blocked B, or B blocked A).**

- **Chat**: in any conversation between them, `canSend` is false for both, and `POST /conversations/:id/messages` → 403 `{error: "blocked", code: "FORBIDDEN"}`. Both can still read it. `Conversation.blockedByMe` tells the client whether to offer Unblock.
- **New conversations**: `POST /conversations` and `POST /bookings/:id/conversation` → 403 `{error: "blocked", code: "FORBIDDEN"}` when no conversation exists yet (an existing one is still returned, read-only).
- **New bookings**: `POST /bookings` → 403 `{error: "blocked", code: "FORBIDDEN"}`.
- **Browse**: neither sees the other's listings in `GET /listings`, and `GET /listings/:id` → 404.
- **Existing bookings continue.** Money and obligations are involved, so every action on a booking that already exists (accept, pay, inspect, return, dispute, refund, award, rating) works as before. The two coordinate through the booking screens; if that breaks down, the dispute flow and the society admins are the way out.

### Reports review (society admin; platform admins too)

Message reports (under Chat), user reports and listing reports share one "Reports" page in the society console (`/admin/<societyId>/reports`). The arbiter rule applies: reports where the caller is the reporter, the reported user or the listing owner, or lives in either side's unit, are **left out** (and 404 on the action routes).

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/societies/:id/user-reports?status=open\|closed` | default `open` → `UserReport[]`, newest first, max 100. `closed` = `reviewed` + `dismissed`. 404 non-member, 403 `society_admin_required` for a resident. |
| POST | `/admin/user-reports/:id/review` | `{decision: "reviewed"\|"dismissed", note?: string (≤1000)}` → `UserReport`. Records the decision only; to act on a person, revoke their membership as usual. Repeating it on a closed report returns it unchanged. |
| GET | `/admin/societies/:id/listing-reports?status=open\|closed` | default `open` → `ListingReport[]`, newest first, max 100. `closed` = `dismissed` + `actioned`. |
| POST | `/admin/listing-reports/:id/dismiss` | `{note?: string (≤1000)}` → `ListingReport` (status `dismissed`). Unchanged if already closed. To take the listing down use `POST /admin/listings/:id/remove`, which marks its open reports `actioned`. |

```
UserReport = {
  id, societyId, status: "open"|"reviewed"|"dismissed",
  reason: "harassment"|"spam"|"scam"|"inappropriate"|"other", details: string|null,
  reporter: PartyInfo, reported: PartyInfo,       // PartyInfo in the report's society
  createdAt, reviewedAt: string|null, reviewNote: string|null
}

ListingReport = {
  id, societyId, status: "open"|"dismissed"|"actioned",
  reason: "prohibited_item"|"misleading"|"offensive"|"scam"|"other", details: string|null,
  reporter: PartyInfo,
  listing: {id, title, status, coverUrl: string|null, owner: PartyInfo},
  createdAt, reviewedAt: string|null, reviewNote: string|null
}
```

## Bookings (state machine: see infra/blueprint.md §5)

`state ∈ REQUESTED ACCEPTED DEPOSIT_HELD HANDOVER_PENDING ACTIVE OVERDUE RETURN_PENDING COMPLETED DISPUTED RESOLVED DECLINED EXPIRED CANCELLED`

**Response convention:** every `POST /bookings/:id/...` action below returns the fresh `BookingDetail` (status 200) unless another shape is stated. State-changing actions run as Temporal workflow updates, so the response already reflects the new state.

| Method | Path | Who | Effect |
|---|---|---|---|
| POST | `/bookings` | borrower | `{listingId, startsAt, endsAt, pricing: "hourly"\|"daily"\|"weekend"}` → 201 `Booking` (REQUESTED). 403 `blocked` if either party has blocked the other. 409 `OVERLAP` if busy. Fee: hourly = ceil(hours)×rate, daily = ceil(24 h days)×rate, weekend = flat. Max 30 days. 403 if the borrower has an unpaid dispute award or trust < 2.0. Weekend pricing: the booking must start no earlier than Fri 12:00 IST and end no later than Mon 12:00 IST of the same weekend (else 400). |
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
| POST | `/bookings/:id/disputes/respond` | other party | `{responseText, offerPaise?}` (offer ≤ claim; once). Notifies the raiser by push + email (see "Dispute notices"). With an offer, the raiser's `nextAction` becomes `accept_offer` until the dispute is resolved. |
| POST | `/bookings/:id/disputes/accept-offer` | raiser | settles at `offerPaise` → RESOLVED. Allowed any time while DISPUTED (also after escalation). Notifies the responder by push + email. |
| POST | `/bookings/:id/disputes/ruling` | society admin (not a party, not same unit) or platform admin; **pilot societies: platform admin only** (403 `pilot_platform_rules`) | `{awardPaise ≤ claimedPaise, note}` → RESOLVED |
| POST | `/bookings/:id/deposit/refund-claim` | lender | "I've refunded": any refund owed (p2p deposit after COMPLETED, or fee/+deposit after a paid CANCELLED) |
| POST | `/bookings/:id/deposit/refund-confirm` | borrower | "Refund received" (stops the 24 h timer). 409 while a dispute is open; the ruling decides what is still owed (net of any refund already confirmed). |
| POST | `/bookings/:id/award/paid-claim` · `/award/paid-confirm` | award payer · award payee | settles an award recorded as debt. The payer is the party who did NOT raise the dispute (usually the borrower, but the lender when the borrower won). See `payment.awardPayerId`. |
| POST | `/bookings/:id/ratings` | party, after COMPLETED/RESOLVED | `{stars 1-5, punctual?, careful?, asDescribed?, comment?}` → 201 `{id, bookingId, rateeId, stars, punctual, careful, asDescribed, comment, createdAt}`. Once per party (409 `ALREADY_SUBMITTED`). |

`Booking = {id, state, listing: {id, title, kind, category}, lender: PartyInfo, borrower: PartyInfo, startsAt, endsAt, pricing, feePaise, depositPaise, replacementValuePaise: number|null, platformFeePaise (0 in Phase 1), myRole: "lender"|"borrower"|"admin", nextAction: string|null, deadlineAt: string|null}`

`PartyInfo = {id, displayName, towerName, flatNo, trust}`

`BookingDetail = Booking & {society: {id, name, centerLat, centerLng, radiusM}, checklistSnapshot, photoSlotsSnapshot, payment: Payment|null, inspections: Inspection[], dispute: Dispute|null, events: [{fromState, toState, reason, at}], conversationId: string|null}`. `conversationId` = the chat between this booking's lender and borrower about this listing (see "Chat"), or `null` if neither has opened it yet; a party gets or creates it with `POST /bookings/:id/conversation`.

`Payment = {depositMode: "declared"|"p2p", feePaise, depositPaise, feeUpiIntent: string, depositUpiIntent: string|null, refundUpiIntent: string|null, awardUpiIntent: string|null, claimedAt, confirmedAt, utr, depositStatus: "none"|"pending"|"declared"|"held_by_lender"|"refund_claimed"|"refunded"|"released", refundDuePaise, refundClaimedAt, refundConfirmedAt, awardPaise, awardFromDepositPaise, awardStatus: "none"|"debt_recorded"|"settled_from_deposit"|"paid_claimed"|"paid", awardPayerId, awardPayeeId}`. `null` until the lender accepts. p2p + lender wins: up to the deposit is kept by the lender (`awardFromDepositPaise`) and `refundDuePaise` = deposit − that. Any excess makes `awardStatus: "debt_recorded"` with `awardUpiIntent` for `awardPaise − awardFromDepositPaise`; otherwise `awardStatus` is `settled_from_deposit`.

UPI intent format: `upi://pay?pa=<vpa>&pn=<urlencoded name>&am=<rupees with 2 decimals>&cu=INR&tn=<urlencoded "BV-<first 8 of booking id> <purpose>">`, purpose ∈ `rental fee` · `deposit` · `deposit refund` · `dispute award`.

`Inspection = {id, phase, party: "lender"|"borrower", checklistAnswers, withinGeofence, noLocation, submittedAt, media: Media[], ack: {result, note, at, media: Media[]}|null}`

`Media = {id, slot, url (presigned GET, 10 min), mime, receivedAt, withinGeofence, noLocation, clockSkewFlag}`

`Dispute = {id, raisedBy: userId | "system", raisedBySystem, category, description, claimedPaise, responseText, offerPaise, status, awardPaise, rulingNote, resolvedAt, createdAt, escalatedAt, deadlineAt, media?}`. `raisedBy` is `"system"` for the auto-raised p2p refund dispute (on the borrower's behalf). `media` (in `BookingDetail` only) = the dispute evidence, `Media[]`. `status ∈ open awaiting_response under_review escalated resolved withdrawn`.

`nextAction` values (so clients don't re-derive the state machine): `accept_or_decline`, `wait_lender`, `pay`, `confirm_payment`, `wait_payment`, `handover_inspect`, `handover_ack`, `wait_handover`, `return_inspect`, `review_return`, `wait_review`, `respond_dispute`, `accept_offer`, `wait_ruling`, `refund_deposit`, `confirm_refund`, `pay_award`, `confirm_award`, `rate`, `null`. `review_return` = the lender hasn't acked the borrower's return yet, OR objected and should now raise a dispute. `accept_offer` = DISPUTED, you raised the dispute (the borrower, for a system-raised one), and the other party responded with a settlement offer you can accept (it stays open until a ruling, also after escalation); otherwise the raiser gets `wait_ruling`. Clients badge bookings whose `nextAction` is `accept_offer` ("offer waiting"), derived from `GET /bookings` with no extra endpoint. `deadlineAt` = when the next timer fires if nobody acts.

## Chat (lender ↔ borrower)

One **conversation per (listing, borrower)**. Its participants are exactly the listing owner (`myRole: "owner"`) and that borrower (`myRole: "borrower"`). A prospective borrower opens it from a listing ("Ask a question") before booking; the same conversation carries on through every booking of that listing by that borrower. Text only. **Messages are immutable**: there is no edit or delete route (they can be dispute evidence), and the database rejects UPDATE/DELETE on messages.

**Delivery is polling** (no websockets). While a chat is open, poll `GET /conversations/:id/messages?after=<id of the newest message you hold>` about every 5 s; use `GET /conversations/unread` for badges. A new message also sends a **push notification** to the other participant's registered app devices (see "Push notifications" below). There are **no chat emails** in Phase 1.

| Method | Path | Who | Body → Response |
|---|---|---|---|
| POST | `/conversations` | borrower-to-be | `{listingId}` → `Conversation`: **200** if the caller already has a conversation on that listing, **201** if it was just created. 403 `{error: "cannot_message_own_listing", code: "FORBIDDEN"}` for the listing's owner. Creating a new one needs an **approved** membership in the listing's society and a listing that isn't `archived` or `removed` (`active` and `paused` are fine); otherwise 404 (unknown listing, other society, pending/revoked membership, archived/removed: all look the same). 403 `{error: "blocked", code: "FORBIDDEN"}` when either side has blocked the other and no conversation exists yet. An existing conversation is always returned (200), whatever the listing/membership status. Rate limited: 20 / hour per user → 429 `{error: "rate_limited"}`. |
| POST | `/bookings/:id/conversation` | booking party (lender or borrower) | no body → `Conversation` for that booking's (listing, borrower), **200** existing / **201** created. Works for any booking state. 404 for anyone else (admins included: they use `BookingDetail.conversationId`). Rate limited: 20 / hour per user (separate bucket). |
| GET | `/conversations` | ✓ | → `ConversationSummary[]`, newest activity first (`lastMessageAt`, else `createdAt`), max 100. The borrower sees every conversation they opened; the **owner only sees conversations that have at least one message**. |
| GET | `/conversations/unread` | ✓ | → `{total: number, byConversation: {[conversationId]: number}}` (only conversations with unread > 0 appear in `byConversation`). Counts messages from the other participant after your read marker. |
| GET | `/conversations/:id` | participant, or eligible admin (below) | → `Conversation`. 404 otherwise. |
| GET | `/conversations/:id/messages?after=&before=&limit=` | participant, or eligible admin | → `{messages: Message[], hasMore: boolean}` (see Paging). Reading does **not** mark anything read. |
| POST | `/conversations/:id/messages` | participant | `{body: string}` → **201** `Message`. `body` is trimmed, then must be 1–2000 characters (Unicode code points): 400 `{error: "message_empty"\|"message_too_long", code: "VALIDATION"}`. 403 `{error: "blocked", code: "FORBIDDEN"}` when either participant has blocked the other. 409 `{error: "conversation_closed", code: "CONFLICT"}` when `canSend` is false. 403 `{error: "participants_only", code: "FORBIDDEN"}` for an eligible admin. Rate limited: 30 / minute per user → 429 `{error: "rate_limited"}`. Sending also moves your read marker to your new message (everything before it counts as read for you). |
| POST | `/conversations/:id/read` | participant | `{upToMessageId?: uuid}` → **204** (send `{}` to mark everything read; an empty body with `Content-Type: application/json` is a 400). Moves your read marker to that message (it must belong to this conversation, else 400 `invalid_cursor`); without it, to the latest message. The marker never moves backwards. 403 `participants_only` for an eligible admin. |
| POST | `/messages/:id/report` | participant | `{reason: string}` (trimmed, 5–500 chars, else 400) → **201** `{id, messageId, status: "open", createdAt}`. Only the **other** participant's messages: 403 `{error: "cannot_report_own_message", code: "FORBIDDEN"}`. Once per message per reporter: 409 `{error: "already_reported", code: "CONFLICT"}`. 403 `participants_only` for an eligible admin; 404 for everyone else. The society's admins are emailed (best effort, no message content; link `/admin/<societyId>/reports`). Rate limited: 20 / hour per user. |

There are **no** `PATCH`/`PUT`/`DELETE` routes for conversations or messages.

**Who may send (`canSend`).** Never while either participant has blocked the other (see "Users: blocking and reporting"). Otherwise a participant may send when **either** (a) a booking of this listing by this borrower is live (`REQUESTED ACCEPTED DEPOSIT_HELD HANDOVER_PENDING ACTIVE OVERDUE RETURN_PENDING DISPUTED`) or changed state within the last **7 days** (covers refund/award follow-ups after COMPLETED/RESOLVED/CANCELLED), **or** (b) the listing isn't `archived` or `removed` **and** the sender has an approved membership in the society. Otherwise the conversation is read-only for them (`canSend: false`, send → 409 `conversation_closed`). Participants can always read their conversations, even after the listing is archived or their membership is revoked.

**Admin read access (disputes).** While any booking of this listing by this borrower is `DISPUTED` or `RESOLVED`, the society's admins and platform admins can read the **whole** conversation (`GET /conversations/:id` and `/messages`), read-only, with `myRole: "admin"`, `canSend: false`, `unreadCount: 0`. The arbiter rule applies: an admin who lives in either participant's unit gets 404. Admins find the conversation through `BookingDetail.conversationId` on `GET /bookings/:id` (`null` = the parties never chatted). Admins can't send, mark read or report (403 `participants_only`).

**Paging.** `limit` 1–100, default 50. `after` and `before` are message ids from this conversation (400 `invalid_cursor` otherwise; 400 if both are given). `messages` is **always oldest first**.
- no cursor: the newest `limit` messages; `hasMore` = older messages exist (page back with `before=<messages[0].id>`).
- `before=<id>`: the `limit` messages just older than `id`; `hasMore` = still older ones exist.
- `after=<id>`: the `limit` messages just newer than `id`; `hasMore` = more new ones exist (fetch again immediately with `after=<last id>`). Polls use this.

Messages are totally ordered (a server-side sequence; a later message never appears before an earlier one), so `after=` polling never skips a message. Clients must not reorder by `createdAt`.

```
Message = {id, senderId, body, createdAt}

Conversation = {
  id, societyId,
  listing: {id, title, status: "active"|"paused"|"archived"|"removed", coverUrl: string|null},
  owner: PartyInfo, borrower: PartyInfo,
  myRole: "owner"|"borrower"|"admin",
  canSend: boolean,
  blockedByMe: boolean,            // the caller has blocked the other participant (false for admins)
  unreadCount: number,             // for the caller; 0 for admins
  activeBookingId: string|null,    // newest live booking of this listing by this borrower (live = the states listed under canSend (a))
  bookings: [{id, state, startsAt, endsAt}],   // every booking of this listing by this borrower, newest first
  createdAt, lastMessageAt: string|null
}

ConversationSummary = {
  id, societyId,
  listing: {id, title, status, coverUrl: string|null},
  other: PartyInfo,                // the other participant
  myRole: "owner"|"borrower",
  lastMessage: {id, senderId, body, createdAt} | null,   // body truncated to 140 chars (ends with "…" when cut)
  lastMessageAt: string|null,
  unreadCount: number,
  activeBookingId: string|null
}
```

### Push notifications (Expo push service)

Sending a message (`POST /conversations/:id/messages`) notifies the **other participant** only: never the sender, and never admins (admins only read). Delivery is best effort and **fire-and-forget**: the push runs in the background and can never delay or fail the send route (still 201).

- **Who.** Skipped when the recipient has `chatPushEnabled: false` or no registered tokens. Every token the recipient has registered gets the message.
- **Payload.** `POST https://exp.host/--/api/v2/push/send`, JSON array in batches of ≤ 100, 5 s timeout. `Authorization: Bearer <EXPO_ACCESS_TOKEN>` is sent only when that optional env var is set.
  ```
  { to: <token>,
    title: <sender displayName>,
    body: "<listing title>: <message preview>",   // preview = the message, truncated to 100 chars ("…" when cut)
    data: { type: "chat", conversationId },
    sound: "default", priority: "high",
    channelId: "chat" }                          // the app's Android "Messages" channel
  ```
- **Throttle.** At most **one push per (conversation, recipient) per 60 s**, **unless** the recipient has read past the previously pushed message (their read marker ≥ its sequence); then the next message pushes straight away. The throttle state is **in memory, per API process** (borrowvault-api is one container; a restart forgets it, which at worst sends one extra push).
- **Tickets.** A ticket with `details.error: "DeviceNotRegistered"` deletes that token. Other ticket errors and transport failures are logged and dropped (no retry). Push **receipts are not polled** in Phase 1, so a token that only fails at the receipt stage stays until a later ticket reports `DeviceNotRegistered`.
- **Other pushes.** A co-admin nomination also pushes the nominee (`data.type: "admin_nomination"`, see "Co-admin nominations"), and a join request pushes the society's admins (`data.type: "join_request"`, see "Join request notice"). They ignore `chatPushEnabled` and the chat throttle.
- **Clients.** Tapping the notification opens `/chat/<conversationId>` (from `data.conversationId`). The app suppresses the banner while that conversation is already on screen. Web has no push.

#### Dispute notices (push + email)

Sent by the API after the change commits, fire-and-forget: a failure never fails the route or retries the Temporal activity. Email goes over the usual mailer (SMTP), HTML + text, with a button and the raw link to `<WEB_ORIGIN>/bookings/<bookingId>`. Deleted accounts get neither.

| When | To | Push title / email subject |
|---|---|---|
| `disputes/respond` **with** `offerPaise` | raiser | push `<responder> offered ₹X to settle the dispute on <item>` / email `<responder> offered ₹X to settle your dispute`. The email shows the item, the claim vs the offer, the responder's note, and what to do: accept (settles at once), or leave it and the arbiter (a society admin; the BorrowVault team in a pilot society) rules, escalating to the BorrowVault team 72 h after the dispute was raised. The offer stays open until a ruling. |
| `disputes/respond` **without** an offer | raiser | `<responder> responded to your dispute` (with their note and what happens next) |
| `disputes/accept-offer` | responder | `<raiser> accepted your ₹X offer; dispute settled`. The responder gets this instead of the generic "Dispute resolved" email; the raiser still gets that one. |

Dispute pushes go to **every** token the recipient registered (not gated by `chatPushEnabled`, which is about chat), with `data: {type: "booking", bookingId}` and `channelId: "default"` (the app's Android "Bookings" channel). Tapping one opens the booking (`/booking/<bookingId>` in the app).

### Reported messages (society admin; platform admins too)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/societies/:id/message-reports?status=open\|reviewed` | default `open` → `MessageReport[]`, newest first, max 100. 404 non-member, 403 `society_admin_required` for a resident. Reports on conversations where the caller is a participant or lives in a participant's unit are **left out** (arbiter rule). |
| POST | `/admin/message-reports/:id/review` | `{note?: string (≤1000)}` → `MessageReport` (status `reviewed`). Repeating it on a reviewed report returns it unchanged (200). 404 for unknown ids, other societies, and reports hidden from the caller by the arbiter rule. |

```
MessageReport = {
  id, status: "open"|"reviewed", reason, createdAt,
  reviewedAt: string|null, reviewNote: string|null,
  reporter: {id, displayName},
  conversation: {id, listing: {id, title}, owner: PartyInfo, borrower: PartyInfo},
  message: Message,          // the reported message
  context: Message[]         // up to 5 messages before and 5 after it, plus the message itself, oldest first
}
```

A report doesn't give the admin access to the rest of the conversation; only a DISPUTED/RESOLVED booking does (above). Reviewing records the decision only: messages are never hidden or deleted.

## Timers (Temporal workflow `bookingWorkflow`, task queue `borrowvault`)

- REQUESTED: 12 h → EXPIRED
- ACCEPTED: 2 h without lender confirmation → EXPIRED
- DEPOSIT_HELD: at `startsAt − 1 h` → HANDOVER_PENDING (skills, which have no handover inspection, go straight on to ACTIVE)
- HANDOVER_PENDING: `startsAt + 24 h` → CANCELLED (lender no-show: a trust strike, −0.3 per no-show in 12 months). If payment was confirmed, a refund is owed exactly as for a cancel.
- ACTIVE: at `max(endsAt, activatedAt + 1 h)` → OVERDUE (a late handover still gets an hour, and an OVERDUE caused by a late handover carries no trust penalty), with nudges at +1/+6/+24 h and an admin alert at +48 h after going overdue. `deadlineAt` for ACTIVE uses the same clock.
- RETURN_PENDING: 24 h of lender silence → COMPLETED. An `objected` ack with no dispute raised in that window also auto-completes.
- DISPUTED: 72 h → escalated (platform admin notified). In a pilot society the platform admins are also emailed when the dispute is raised, since only they can rule.
- Refund owed (p2p deposit after COMPLETED, or fee/+deposit after a paid CANCELLED): 24 h without `refund-confirm` → auto dispute (`category: "late"`, `raisedBy: "system"` on behalf of the borrower; COMPLETED/CANCELLED → DISPUTED is a system-only move). Its ruling's `awardPaise` = the amount the lender must still refund.

## Ops

**Request logs.** Fastify request logs keep the method and **path only**: any query string is replaced by `?[redacted]`, so search terms (`GET /listings?q=`), storage keys (`/storage/url?key=`) and the like never reach the 30-day logs.

| GET | `/health` | → `{ok: true, commit, startedAt}` |
| GET | `/metrics` | `Authorization: Bearer <METRICS_TOKEN>`. Uses the shared envelope; `collector.ts` is copied verbatim from evitevault; app key `"borrowvault"`. `counts` keys: `users, liveSocieties, pilotSocieties, approvedMembers, pendingMembers, adminRequestsPending, activeListings, bookings, openBookings, completedBookings, openDisputes, activeSessions, conversations, messagesLast24h, openMessageReports, lifetimeBookingsCreated, lifetimeBookingsCompleted, lifetimeListingsCreated`. The three `lifetime*` keys are sums over `platform_stats_daily` (see "Lifetime stats"), so they survive the 3-year purge and lag the live tables by up to an hour. |

### Lifetime stats (`platform_stats_daily`)

Non-personal activity counts that outlive the personal data they were counted from (Privacy Policy, "Statistics we keep"). One row per **IST calendar day** per society; primary key `(day, society_id)`.

| Column | Meaning |
|---|---|
| `day` | `date`, Asia/Kolkata |
| `society_id` | `uuid`, **no foreign key**: the counts must survive the society row. A society is an organisation, not a person, and per-society counts are needed to judge pilots |
| `bookings_created` | bookings created that day |
| `bookings_completed` | bookings that first reached `COMPLETED` or `RESOLVED` that day (one finished lending = one finished borrowing) |
| `disputes_raised` | disputes raised that day |
| `listings_created` | listings created that day |
| `listings_active` | gauge: active listings at the last rollup that day. Null on backfilled days |
| `members` | gauge: approved memberships at the last rollup that day. Null on backfilled days |
| `updated_at` | when the rollup last wrote the row |

Counts only: no user ids, names, flats, text or keys, ever. Don't add a column that could identify a person.

**Rollup.** The worker process (`borrowvault-worker`) runs it at start and then hourly (`api/src/lib/platformStats.ts`). Each run recomputes the event counts for the last 3 IST days from the live tables and upserts them, then upserts today's gauges for every live society. It is idempotent: re-running gives the same rows. If the table is empty (first run), it backfills every day from the oldest data instead. Days older than the 3-day window are never rewritten, so purging old personal data can't lower them. Lifetime totals = `sum(...)` over all rows.

## Data retention (Privacy Policy section 7)

Rule: personal data is kept for **3 years after the person's last activity** (the later of their last sign-in and the end of their last booking, dispute or admin request; closing the account counts as activity), then deleted. Logs and database backups roll over at 30 days.

**No purge job exists yet. One must ship before 2029-11** (3 years after launch, when the first data qualifies). It must:

- **Delete** for each user past the rule: the `users` row and its sessions, reset tokens and push tokens; their memberships and proof files; their admin requests and `admin-docs/` files; their listings and listing photos; and, for bookings where **both** parties are past the rule, the booking with its events, payments, inspections and evidence media (R2 objects too), disputes, dispute messages, ratings, conversations, messages and message reports.
- **Anonymise, not delete,** shared records whose other party is still active: replace the departed user with a tombstone (no name, email, phone, VPA, flat) so the active resident's history still makes sense.
- **Hold** anything tied to an open dispute, an unpaid award or a legal hold until that ends.
- **Keep** `platform_stats_daily` untouched, and `societies` rows (organisations, not people). Only purge data older than the rollup's 3-day window, which the 3-year rule always is.
- Confirm the Coolify backup schedule keeps no more than 30 days of backups, so purged data leaves backups within 30 days.
