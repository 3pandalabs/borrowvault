# BorrowVault on Google Play: submission package

Everything needed to publish the Android app (`app/`, package `com.threepanda.borrowvault`) on Google Play, ready to paste. India first, English.

| File | What it's for |
|---|---|
| `listing.md` | App name, short and full description, category, tags, contacts, "What's new" (with character counts) |
| `data-safety.md` | Every Data safety answer, from the code |
| `content-rating.md` | IARC questionnaire, target audience (18+), ads (none), SDK check |
| `app-access.md` | Reviewer accounts and the App access form text |
| `screenshots.md` | 8-shot list with captions, Play's size rules, how to capture |
| `graphics/icon-512.png` | 512 × 512 hi-res icon (from `app/assets/source/icon.svg`) |
| `graphics/feature-graphic.png` (+ `.svg`) | 1024 × 500 feature graphic |
| `tools/` | Scripts that rebuild the graphics and frame screenshots |

Lines starting **CONFIRM:** in any file are questions for the owner. They're collected at the bottom of this page.

## Rebuilding the graphics

```
cd infra/play-store/tools
npm install
npm run graphics      # icon-512.png, feature-graphic.svg/.png
npm run frame         # screenshots/raw/*.png -> screenshots/framed/*.png
```

Rendering uses `@resvg/resvg-js` with system fonts turned off. Text is the Geist typeface (SIL Open Font License 1.1, the website's font, from the `geist` npm package), converted to outlines with `opentype.js`, so `feature-graphic.svg` contains only paths and renders the same anywhere. Stay on opentype.js 1.3.x: 2.0.0 writes `NaN` into some Geist glyphs (the script now fails loudly if that happens).

## Submission checklist (in order)

### 1. Developer account

- [ ] Create a Play Console **organisation** account for 3PandaLabs LLC at https://play.google.com/console/signup. Developer name: **3PandaLabs**. One-time fee US$25.
- [ ] It needs a **D-U-N-S number** for 3PandaLabs LLC (free from Dun & Bradstreet; can take up to 30 days). The legal name and address must match the D-U-N-S record exactly.
- [ ] Complete identity verification, and add the public developer email (`support@3pandalabs.com`) and website (`https://3pandalabs.com`).
- Why an organisation account: new **personal** accounts must run a closed test with at least 12 testers for 14 days before production. Organisation accounts don't.

### 2. Create the app

- [ ] Play Console → **Create app**. Name `BorrowVault: Neighbour Rentals` (see `listing.md`), default language English (India), **App**, **Free**. Tick the declarations (Developer Program Policies, US export laws).
- [ ] Free is permanent: a free app can never become paid. That's fine; rentals are paid outside the app.

### 3. Store listing

- [ ] **Main store listing:** paste name, short description, full description from `listing.md`.
- [ ] Upload `graphics/icon-512.png`, `graphics/feature-graphic.png`, and 2–8 phone screenshots from `screenshots/framed/` (`screenshots.md`).
- [ ] **Store settings:** category Lifestyle, tags, contact email `support@3pandalabs.com`, website `https://borrowvault.3pandalabs.com`.

### 4. App content (Policy → App content)

- [ ] **Privacy policy:** `https://borrowvault.3pandalabs.com/privacy`.
- [ ] **App access:** `app-access.md` (create the reviewer accounts first).
- [ ] **Ads:** No ads (`content-rating.md`).
- [ ] **Content rating:** IARC questionnaire (`content-rating.md`).
- [ ] **Target audience and content:** 18+ only (`content-rating.md`).
- [ ] **Data safety:** `data-safety.md`, including the **delete-account URL** (doesn't exist yet: see launch blockers).
- [ ] **Government apps:** No, not developed by or for a government.
- [ ] **Financial features:** "My app doesn't provide any financial features". CONFIRM: BorrowVault builds `upi://pay` intent links to another resident's UPI ID but never holds, moves or processes money, offers no loans, wallet or payments service, and has no payment SDK (Terms section 4–5, `CLAUDE.md` Phase 1). If Play's form lists "peer-to-peer payments" as an option, read it carefully: the payment happens in the user's own UPI app, not in BorrowVault. If in doubt, ask Play support before choosing.
- [ ] **Health apps:** No. **News apps:** No. **COVID-19:** No.
- [ ] **Photo and video permissions:** if the built AAB still declares `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO`, Play asks for a declaration and will very likely reject it. Fix first (see risks).
- [ ] **Advertising ID:** "No" (no ads/analytics SDK). If Play detects `com.google.android.gms.permission.AD_ID` in the manifest, remove it via `blockedPermissions` (see risks).

### 5. Build the production AAB

```
cd app
eas build -p android --profile production
```

- `eas.json` → `production` builds an **app-bundle**, points at `https://api.borrowvault.3pandalabs.com`, and auto-increments `versionCode` (`appVersionSource: remote`). The marketing version is `1.0.0` from `app/app.json`.
- The EAS secret file env `GOOGLE_SERVICES_JSON` must exist for the production environment (FCM push; see `app/app.config.js`).
- Let EAS generate and keep the **upload key**, and enrol in **Play App Signing** (the default for new apps).
- Before uploading, check the merged manifest's permissions (see risks): `bundletool dump manifest --bundle app.aab | findstr permission`, or open the AAB in Android Studio → Analyze APK.

### 6. Service account for `eas submit`

1. Google Cloud Console → create (or pick) a project, e.g. `3pandalabs-play`.
2. **APIs & Services → Library → "Google Play Android Developer API" → Enable.**
3. **IAM & Admin → Service accounts → Create service account**, e.g. `eas-submit`. No Cloud roles needed.
4. Open it → **Keys → Add key → Create new key → JSON**. Download it. **Never commit it.** Store it in the password manager.
5. Play Console → **Users and permissions → Invite new users** → paste the service account's email. Under **App permissions** add BorrowVault with: *Release to testing tracks*, *Release apps to production…*, *Manage testing tracks and edit tester lists*, *View app information*. Invite (it's accepted automatically).
6. Upload the key to EAS once: `cd app && eas credentials -p android` → Google Service Account → upload the JSON. (Or set `serviceAccountKeyPath` in `eas.json` → `submit.production.android` to a path **outside** the repo.) Permissions can take up to 24 h to start working.

### 7. First upload: internal testing track

- [ ] **The very first AAB must be uploaded by hand** in Play Console (Testing → Internal testing → Create release → upload). Google's API can't publish an app's first build. After that, `eas submit` works.
- [ ] Add testers (an email list or Google Group), roll out, install via the opt-in link, and run a full booking with the reviewer accounts.
- [ ] Read the **pre-launch report** (Play's automatic device tests). Expect it to stop at sign-in; the App access credentials help it get further.
- [ ] Next builds: `eas build -p android --profile production` then `eas submit -p android --profile production --latest`. `eas.json` sends to the **internal** track (`submit.production.android.track`).

### 8. Production

- [ ] Promote the tested internal release to **Production** (Release → Production → Create release → add from library), or change `track` in `eas.json` to `production` for later builds.
- [ ] Countries: **India** only at first. Add others later.
- [ ] Use a **staged rollout** (e.g. 20%) for the first release.
- [ ] Send for review. First reviews of a new app often take several days. Answer reviewer emails at support@3pandalabs.com quickly.

## Launch risks and policy gaps

Found while checking the code against Play policy. Ordered by how likely they are to block review.

### Blockers

1. **No account deletion.** Play requires an in-app path to delete the account **and** a web URL for the Data safety form. Today the only route is "email privacy@3pandalabs.com" (Privacy Policy section 8), and `api/ROUTES.md` says no deletion route exists. Minimum fix: a `/delete-account` page on the website explaining the email process and what's kept, plus a "Delete account" item in the app's Profile that opens it. Details in `data-safety.md`.
2. **No user blocking.** Play's User Generated Content policy expects apps where users chat to let users block other users, and to report users as well as content. The app has **message reporting** (long-press → Report, `POST /messages/:id/report`, reviewed by the society admin) but **no block feature** anywhere (no route, table or UI). A resident who is being harassed can only report each message. Minimum fix: `POST /users/:id/block` that stops new messages and booking requests between the two users, with "Block" in the chat menu. CONFIRM: whether you ship this before launch or accept the review risk.
3. **No reporting or moderation of listings.** Listings (title, description, photos) are user-generated and visible to the whole society, but there's no "Report listing" and no admin route to remove one: `PATCH /listings/:id` is owner-only. The Terms (section 6) say "We or your society admin can remove a listing that breaks these rules", which the system can't do today. Revoking the owner's membership doesn't help either: `GET /listings` (`api/src/routes/listings.ts`) filters on the viewer's membership and `status = active`, not the owner's membership, so a revoked resident's active listings stay visible (they just can't accept bookings). Minimum fix: "Report listing" (to society admins, like message reports) and an admin "Remove listing" action. Also no "Report user".
4. **Photo permission (`READ_MEDIA_IMAGES`).** `app/app/listing/new.tsx` calls `ImagePicker.requestMediaLibraryPermissionsAsync()` before opening the gallery. On Android 13+ this means the app declares and requests `READ_MEDIA_IMAGES`. Since 2025, Play's Photo and Video Permissions policy allows that only when broad photo access is the app's **core** purpose; picking a few listing photos isn't, and must use the Android **photo picker**, which needs no permission. `launchImageLibraryAsync` already uses the photo picker on Android 13+, so the fix is: drop the `requestMediaLibraryPermissionsAsync` call on Android, and add to `app/app.json` → `android.blockedPermissions`: `android.permission.READ_MEDIA_IMAGES`, `android.permission.READ_MEDIA_VIDEO`, `android.permission.READ_MEDIA_VISUAL_USER_SELECTED`, `android.permission.READ_EXTERNAL_STORAGE`, `android.permission.WRITE_EXTERNAL_STORAGE`. CONFIRM after the build with `bundletool dump manifest`. (Proof upload uses the document picker and the camera, neither of which needs these.)

### Check before submitting

5. **Merged manifest permissions.** `app/app.json` lists only CAMERA and coarse/fine location, but Expo modules add their own. Check the built AAB for, and block if present: `RECORD_AUDIO` (videos are muted, so it shouldn't be there), `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_LOCATION` (would trigger the foreground-service declaration), `ACCESS_BACKGROUND_LOCATION` (must not be there), `SYSTEM_ALERT_WINDOW` (dev-client only), and `com.google.android.gms.permission.AD_ID` (pulled in by some Google libraries; must match the Advertising ID answer). Expected and fine: `INTERNET`, `CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS`, `VIBRATE`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `ACCESS_NETWORK_STATE`.
6. **Location wording.** The permission text in `app/app.json` and the Privacy Policy say location is read "only at the moment you take a handover or return photo". In fact `app/src/lib/location.ts` runs a high-accuracy watch (every 2 s) **while a capture screen is open** (inspection, dispute and objection screens) and stamps the latest fix on the shutter press. It's still foreground-only and doesn't need a Play location declaration, but the wording should match: e.g. "only while you're on a photo screen in the app". Low risk, easy fix. The rationale is otherwise strong: foreground only, optional (a capture with no location is accepted and flagged), and purpose-specific.
7. **Camera permission strings** are good and specific (handover/return and address proof). Videos are muted (`mute`, `recordAudioAndroid: false`), so no microphone permission is requested. Keep it that way.
8. **Search terms in server logs.** Fastify `logger: true` logs URLs with query strings, so Browse searches (`?q=`) sit in logs for up to 30 days. Either declare "In-app search history" in Data safety or redact `q` from logs (`data-safety.md`).
9. **No crash reporting.** Not a policy issue, but with no Sentry/Crashlytics you'll only see crashes in Play Console → Android vitals. Watch it after launch.
10. **Pilot limits and the store text.** The listing describes the pilot caps (50 members, ₹5,000, platform rulings). If those numbers change in `api/ROUTES.md`, update `listing.md` too.
11. **UPI with no UPI app installed.** Reviewers' devices often have no UPI app. The code already handles it: `openUpi` in `app/src/lib/booking.ts` catches the failure and shows "No UPI app found...". Worth one manual check on an emulator.
12. **Email provider.** The Privacy Policy names Google (Gmail SMTP), which matches `api/src/lib/mailer.ts`. If production switches to the shared mailer gateway (Resend), update the policy and `data-safety.md`.

## All CONFIRM items

From `listing.md`:
- Category: Lifestyle (chosen) or Shopping?
- Tags: pick the closest matches the console offers.
- Is support@3pandalabs.com read by someone? It's public on Play.

From `data-safety.md`:
- If Play flags `ACCESS_COARSE_LOCATION`, also declare Approximate location.
- Keep "Developer communications" as an email purpose, or only transactional?
- UPI ID under "User payment info" (recommended) or "Other financial info": pick one.
- In-app search history: declare it, or redact `q` from logs (recommended).
- Is production mail only Gmail SMTP, never the Resend gateway?

From `content-rating.md`:
- IARC category: Social/UGC (recommended) or Utility/Other.
- If the questionnaire asks about sharing personal info such as address with other users, answer Yes (tower + flat).
- The actual rating certificate once issued.

From `app-access.md`:
- Can `play-review@` and `play-lender@3pandalabs.com` be created?
- Demo Heights, or a separate review society?
- Does the form's "other information" box fit the text?
- One manual check of the UPI button on a device with no UPI app (the code handles it).

From this README:
- Financial features declaration: "none" (recommended).
- Ship user blocking before launch, or accept the risk?
- Merged-manifest permissions after the first production build.
