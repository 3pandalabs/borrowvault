# Play Console: Data safety

**App content → Data safety.** Answers derived from the code on `main` (2026-11-09): `app/` (what the Android app sends), `api/ROUTES.md` and `api/src` (what the server stores), and the Privacy Policy (`web/src/app/privacy/page.tsx`). Anything I couldn't settle from the code is marked **CONFIRM:**.

Scope note: the Data safety form covers data **the Android app** collects or shares, including through SDKs inside it. Some things happen only on the website (applying to be a society admin with ID proof, registering a new society with its address and map location, the admin console). They are covered by the Privacy Policy, not this form. The app only links out to the website for those (`app/app/(tabs)/profile.tsx`, `app/app/onboarding/index.tsx`, `app/app/admin-requests.tsx`).

## Section 1: Data collection and security

| Question | Answer | Why |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | Account, flat, photos, location, messages, etc. |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | The app talks only to `https://api.borrowvault.3pandalabs.com` (`app/eas.json`) and uploads/downloads files through HTTPS presigned R2 URLs. Push goes through Expo/FCM over TLS. |
| Do you provide a way for users to request that their data is deleted? | **Yes** | By email to privacy@3pandalabs.com (Privacy Policy section 8). See the deletion section below: Play also needs an **account deletion URL** and an in-app path, which don't exist yet. |

## Section 2: Data types

"Collected" = sent off the device to us. "Shared" = transferred to a third party. Under Play's rules these are **not** sharing: transfers to service providers that process data for us (Cloudflare, Hetzner, Google, Expo), and transfers the user starts themselves where they'd expect it (a resident sending a chat message, or a borrower seeing the lender's UPI ID inside the payment link they're about to use). So every type below is **Collected: yes, Shared: no**.

"Processed ephemerally" is **No** for everything listed, because it is stored.

### Location

| Data type | Collected | Shared | Required or optional | Purposes |
|---|---|---|---|---|
| **Precise location** | Yes | No | **Optional** | App functionality; Fraud prevention, security and compliance |
| Approximate location | No (see note) | No | n/a | n/a |

- What: latitude, longitude, accuracy and capture time, attached to each handover, return and dispute photo or video (`POST /bookings/:id/media/presign` and `POST /bookings/:id/inspections`, field `geo`). The server stores it and computes "inside the society's geofence".
- When: `app/src/lib/location.ts` (`useLocationFix`) asks for foreground permission and runs a high-accuracy watch **only while a capture screen is open** (inspection and dispute screens), then stamps the fix on the shutter press. No background location, no `ACCESS_BACKGROUND_LOCATION`.
- Optional: if the user denies permission or has no fix, the server stores "no location" and never rejects the capture (`api/ROUTES.md`, media presign).
- Note: the manifest declares `ACCESS_COARSE_LOCATION` too (`app/app.json`) because Android requires it alongside fine, but the app requests `Accuracy.Highest` and sends precise coordinates. Declaring precise only is correct. CONFIRM: if Play's pre-launch check flags the coarse permission, also tick Approximate location with the same answers.

### Personal info

| Data type | Collected | Shared | Required or optional | Purposes |
|---|---|---|---|---|
| **Name** | Yes | No | Required | App functionality; Account management |
| **Email address** | Yes | No | Required | App functionality; Account management; Developer communications |
| **User IDs** | Yes | No | Required | App functionality; Account management |
| **Address** | Yes | No | Required | App functionality; Fraud prevention, security and compliance |
| **Phone number** | Yes | No | Required | App functionality; Account management; Fraud prevention, security and compliance |
| Race and ethnicity, Political or religious beliefs, Sexual orientation | No | | | |
| **Other info** | Yes | No | Required | App functionality |

- Name: display name at sign-up (`POST /auth/signup`), shown to society members on listings, bookings and chats.
- Email: sign-in, password reset and service emails (admin-request decisions, dispute notices). "Developer communications" covers those service emails. CONFIRM: if you never plan to email users anything but transactional mail, you can drop "Developer communications"; transactional mail is still "Account management / App functionality".
- User IDs: the account's server-side UUID, plus the email used as login.
- Address: the society, tower and flat number chosen at join (`POST /societies/:id/join`). That is a postal address in all but street name, so declare it. Shown to approved members of the same society.
- Phone: required at sign-up (`app/app/(auth)/sign-up.tsx`); shown to society admins when they review your membership and to platform admins. Not shown to other residents.
- Other info: occupancy (owner / tenant / family), ratings and trust score, the society admin's review note.

### Financial info

| Data type | Collected | Shared | Required or optional | Purposes |
|---|---|---|---|---|
| **User payment info** | Yes | No | **Optional** | App functionality |
| **Purchase history** | Yes | No | Required | App functionality; Fraud prevention, security and compliance |
| Credit score | No | | | |
| Other financial info | No (see note) | | | |

- **Does a UPI ID (VPA) count as financial info? Yes, declare it.** A VPA like `name@okbank` is a payment address tied to a bank account. Play's "User payment info" is described as credit/debit card or bank account numbers; a VPA is the closest match, and over-declaring is safe while under-declaring is a policy strike. Optional: it's only needed to lend (`PATCH /me`, `upiVpa`; listings and accepting bookings need it).
- What the app does **not** collect: card numbers, bank account numbers, UPI PINs or balances. Payment happens in the user's own UPI app through a `upi://pay` intent (`api/ROUTES.md`, "UPI intent format"). BorrowVault never holds or moves money.
- Purchase history: each booking's fee, deposit, refund and award amounts, the "I've paid" / "Received" confirmations, and an optional UPI transaction reference (UTR) the borrower can type in (`POST /bookings/:id/payment/claim`).
- CONFIRM: some reviewers file a VPA under "Other financial info" instead of "User payment info". Either is defensible. Pick one, not both, and keep it consistent with the Privacy Policy wording ("Your UPI ID (VPA)").

### Health and fitness

Not collected.

### Messages

| Data type | Collected | Shared | Required or optional | Purposes |
|---|---|---|---|---|
| Emails | No | | | |
| SMS or MMS | No | | | |
| **Other in-app messages** | Yes | No | Optional | App functionality; Fraud prevention, security and compliance |

- Lender ↔ borrower chat (`POST /conversations/:id/messages`), text only, stored permanently (no edit/delete; they can be dispute evidence). Read markers. Message reports with a reason. Society admins and platform admins can read a chat only while a booking between those two is disputed or resolved, and see a reported message with 5 messages of context.
- Also counts here: dispute descriptions and responses, and objection notes (free text sent to the other party).
- Optional: you can borrow and lend without ever chatting.
- Fraud prevention: reports and dispute evidence.

### Photos and videos

| Data type | Collected | Shared | Required or optional | Purposes |
|---|---|---|---|---|
| **Photos** | Yes | No | Required | App functionality; Fraud prevention, security and compliance |
| **Videos** | Yes | No | Optional | App functionality; Fraud prevention, security and compliance |

- Photos: (1) handover, return, objection and dispute photos, in-app camera only (`app/src/components/Evidence.tsx`); (2) listing photos picked from the gallery (`app/app/listing/new.tsx`, `launchImageLibraryAsync`); (3) a photo of the address proof taken with the camera (`app/app/onboarding/join.tsx`, `launchCameraAsync`).
- Required: an item listing needs at least one required handover photo slot, so anyone lending or borrowing an item takes photos. (Borrowing a skill doesn't.)
- Videos: an optional video of up to 15 seconds at handover/return (`VIDEO_MAX_S = 15`). **Recorded muted**: `CameraView ... mute`, `recordAudioAndroid: false`, `microphonePermission: false` in `app/app.json`. So **Audio is not collected**.
- Each capture's SHA-256 hash is computed on the device and re-checked on the server; the server keeps an immutable copy.

### Audio

Not collected (videos are muted, no microphone permission).

### Files and docs

| Data type | Collected | Shared | Required or optional | Purposes |
|---|---|---|---|---|
| **Files and docs** | Yes | No | Optional | App functionality; Fraud prevention, security and compliance |

- The proof-of-residence document (PDF, JPEG or PNG, up to 10 MB) picked with `expo-document-picker` when joining a society (`app/app/onboarding/join.tsx`). Optional: an 8-character invite code from the society admin replaces it. Only the uploader, that society's admins and platform admins can open it.

### Calendar, Contacts

Not collected. (Booking dates are stored, but nothing is read from the device calendar.)

### App activity

| Data type | Collected | Shared | Required or optional | Purposes |
|---|---|---|---|---|
| App interactions | No | | | |
| In-app search history | **CONFIRM** | | | |
| Installed apps | No | | | |
| **Other user-generated content** | Yes | No | Required | App functionality |
| **Other actions** | Yes | No | Required | App functionality; Fraud prevention, security and compliance |

- Other user-generated content: listing titles, descriptions, prices, checklists; checklist answers; ratings and comments.
- Other actions: booking requests, accept/decline/cancel, payment and refund confirmations, inspection submissions and acks, every booking state change with its time (`booking_events`).
- App interactions: No. There is no analytics SDK and no tap/screen tracking (see "SDKs" below).
- **CONFIRM: In-app search history.** The Browse search box sends `q` to `GET /listings?q=`. The server doesn't store searches in the database, but Fastify runs with `logger: true` (`api/src/index.ts`), which logs each request URL, query string included, and logs are kept up to 30 days (Privacy Policy section 7). Either (a) declare In-app search history as Collected, optional, App functionality, or (b) redact `q` from request logs and leave it undeclared. I'd do (b); it's a one-line serializer change.

### Web browsing

Not collected.

### App info and performance

| Data type | Collected | Shared |
|---|---|---|
| Crash logs | No | |
| Diagnostics | No | |
| Other app performance data | No | |

No crash reporter (no Sentry, Bugsnag, Crashlytics) in `app/package.json`. Server-side request logs (IP, URL, status) are not "app performance data" in Play's sense.

### Device or other IDs

| Data type | Collected | Shared | Required or optional | Purposes |
|---|---|---|---|---|
| **Device or other IDs** | Yes | No | Optional | App functionality |

- The Expo push token (`POST /me/push-tokens`, `ExponentPushToken[...]`) and platform ("android"), stored to send chat notifications. Deleted on sign-out, password reset, or when Expo reports the device unregistered.
- Under the hood the push token wraps an FCM token, and Firebase Cloud Messaging (via `expo-notifications` and `google-services.json`) creates a Firebase installation ID on the device. That's collection by an SDK in our app, for the same purpose, so it's covered by this row.
- Optional: the user can deny the notification permission (Android 13+), or turn chat push off in Profile.

## Service providers (not "sharing", but list them for your own records)

From Privacy Policy section 6 and the code:

| Provider | Role | Data |
|---|---|---|
| Cloudflare, Inc. | Website hosting, DNS, proxy in front of the API, R2 file storage | Everything passes through its proxy; photos, videos, proofs and documents stored in R2 |
| Hetzner Online GmbH (Germany) | Servers for the API, Postgres database and Temporal | All account and booking data |
| Google LLC | Service email over Gmail SMTP from 3pandalabs@gmail.com (`api/src/lib/mailer.ts`); FCM push delivery on Android | Email address, subject and body; push payload |
| Expo (650 Industries, Inc.) | Push notification relay (`exp.host`) | Push token, sender's display name, listing title, first 100 characters of the message |

CONFIRM: `api/src/env.ts` also supports the org's shared mailer gateway (`MAILER_URL`, Cloudflare Worker → Resend). The policy names only Google. If production ever sends through the gateway, add Resend to the Privacy Policy.

## SDKs in the Android app

From `app/package.json`: Expo SDK 57 modules only (camera, location, image-picker, document-picker, notifications, secure-store, file-system, crypto, device, linking, router, font, etc.), React Native, AsyncStorage, NetInfo, and the datetime picker.

**No analytics, advertising, attribution or crash-reporting SDK.** None of Firebase Analytics, Google Analytics, Sentry, Amplitude, Mixpanel, Segment, AppsFlyer, Branch, AdMob or Meta SDK. The only Google SDK is Firebase Cloud Messaging, pulled in for push.

## Account deletion (required)

Play requires, for any app where users can create an account:

1. an **in-app path** to request account deletion, and
2. a **web link** (entered in the Data safety form, "Delete account URL") where users can request deletion without reinstalling the app. The page must name the app/developer and say what's deleted and what's kept.

Today: there is no delete-account route or button (`api/ROUTES.md`: "There is no account-deletion ... route"), and the Privacy Policy says to email privacy@3pandalabs.com. **That is not enough on its own: this blocks submission.** Minimum fix, no backend work needed:

- Add a page `https://borrowvault.3pandalabs.com/delete-account` with the steps (email privacy@3pandalabs.com from your account's address, subject "Delete my BorrowVault account"), what's deleted, what's kept and for how long (from Privacy Policy sections 7–8), and the response time.
- Add a "Delete account" row in the app's Profile tab that opens that page or a prefilled `mailto:`.
- Put the page URL in the Data safety form.

Better later: a real `DELETE /me` route that also deletes push tokens (as `api/ROUTES.md` already requires of any such route).

## Other Data safety questions

| Question | Answer |
|---|---|
| Is your app's data collection compliant with the Families policy? | Not applicable: the app isn't for children (target audience 18+). |
| Has your app been independently validated against a global security standard (MASA)? | No. |
| Do you allow users to sign in with an account? | Yes: username/email and password. No other sign-in methods. |
