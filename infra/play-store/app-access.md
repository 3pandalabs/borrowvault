# Play Console: App access (reviewer login)

**App content → App access → "All or some functionality in my app is restricted".**

Everything past sign-in is gated: a new account sees only "Find your society", and nothing works until a society admin approves the membership (`app/app/onboarding/`). A reviewer who signs up fresh gets stuck on "Verification" (`onboarding/pending.tsx`). So Play needs ready, **already approved** accounts.

**No passwords go in this repo.** Generate them when you create the accounts, keep them in the password manager, and type them only into the Play Console form.

## The plan: two reviewer accounts in "Demo Heights"

"Demo Heights" is the seeded society (`api/src/db/seed.ts`): city Bengaluru, towers A and B, geofence 300 m around 12.9716, 77.5946, deposit mode `declared`, tier `verified` (the schema default, so no pilot caps). Its society admin lives in A-101.

Two accounts, so a reviewer can play both sides of a booking (a booking can't move past "requested" without the other party):

| Account | Email | Display name | Flat | UPI ID | Role |
|---|---|---|---|---|---|
| Reviewer (borrower) | `play-review@3pandalabs.com` | Play Reviewer | B-901 | `borrowvault-review@invalid` | resident |
| Demo lender | `play-lender@3pandalabs.com` | Demo Lender | A-202 | `borrowvault-demo@invalid` | resident |

- **UPI IDs end in `@invalid` on purpose.** They pass the app's format check (`^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$`) but no UPI app can resolve them, so a reviewer who taps "Pay via UPI" can never send money to a real person. Never use a realistic-looking VPA here.
- Phone: `+910000000000` (as the seed does), or a 3PandaLabs number.
- CONFIRM: that `play-review@` and `play-lender@` can be created as aliases on the 3pandalabs.com mailbox (or pick existing addresses). Sign-up doesn't verify email, but password reset does use it.

## Creating them (owner or Claude, before submission)

1. **Sign up both accounts** in the app (or at https://borrowvault.3pandalabs.com), with strong generated passwords. Tick the 18+ / Terms box.
2. **Society admin creates invite codes:** sign in to the website as the Demo Heights society admin (`SEED_SOCIETY_ADMIN_EMAIL`, see the BorrowVault seed-logins note) → Demo Heights → invite codes → one for tower B, one for tower A.
3. **Join:** in each account, Find your society → "Demo Heights" → tower/flat from the table → occupancy "Owner" → paste the invite code (no proof upload needed with a valid code) → Send for verification.
4. **Approve** both memberships in the society admin console.
5. **Profile → Your details:** set the UPI IDs from the table. Leave chat notifications on.
6. **Seed content as the demo lender** (use any royalty-free or your own photos; nothing personal):
   - Item: "Cordless drill (demo)", Power tools, ₹150/day, deposit ₹500, one required photo slot "Front".
   - Item: "4-person camping tent (demo)", Camping, ₹300/day, weekend ₹500, deposit ₹1,000, slots "Packed bag" and "Pitched".
   - Skill: "Weekend baking lesson (demo)", Baking, ₹400/hour.
7. **Seed one listing as the reviewer** too: "Board games set (demo)", Party, ₹100/day, deposit ₹0, slot "Box contents". This lets the reviewer try the lender side alone.
8. Sign in once as each account **on a phone** to confirm the Browse tab shows the other's listings and chat works both ways.
9. Recheck **the week before each submission**: an account only stays usable while its membership is approved, and trust drops below 2.0 block new bookings (`api/ROUTES.md`, `POST /bookings`).

CONFIRM: whether you want these accounts in Demo Heights (shared with any manual QA) or in a separate "Play Review Heights" society created with `POST /platform/societies`. Demo Heights is simpler; a separate society keeps review traffic out of QA data.

## What to paste into the App access form

Add one instruction set:

- **Name:** Reviewer login
- **Username / email:** `play-review@3pandalabs.com`
- **Password:** `<<SET BEFORE SUBMISSION, from the password manager>>`
- **Any other information:**

```
BorrowVault only works for residents verified by their society. This account is already an approved resident of the test society "Demo Heights" (Tower B, Flat 901), so you can sign in and use everything.

Second account (the other side of a booking): play-lender@3pandalabs.com, password: <<SET BEFORE SUBMISSION>>. It owns the "(demo)" listings.

To try a full booking:
1. As play-review, open Browse, pick "Cordless drill (demo)", choose a start time within the next hour and send a request.
2. Sign out, sign in as play-lender, open My bookings, accept. Payment is by UPI outside the app; the demo UPI IDs are deliberately invalid, so no money can move. Tap "Received" as the lender to continue.
3. At handover both accounts take photos with the in-app camera. Camera and location permission are asked for then. Location is only used to check the photo was taken inside the society; outside Bengaluru the photo is marked "outside society" but still accepted.
4. Chat: on any listing tap "Ask a question". Long-press the other person's message to report it.

No payment, subscription or in-app purchase exists. Contact: support@3pandalabs.com
```

CONFIRM: Play limits the "other information" box (about 500 characters in some console versions). If it's cut off, keep steps 1 and 2 and the second login, and drop the rest.

## Things a reviewer may trip on

- **Booking deadlines.** A request expires after 12 h and an accepted booking after 2 h without payment confirmation (`api/ROUTES.md`, Timers). Expired demo bookings are harmless; the reviewer just makes a new one.
- **Handover timing.** The handover step opens 1 hour before the booking start. That's why the form text asks for a start time within the next hour; otherwise the booking sits at "paid" until then.
- **Messages can't be deleted.** Anything a reviewer writes in chat stays in the database. Harmless, but don't reuse these accounts for screenshots.
- **The UPI button** opens the phone's UPI app chooser. With no UPI app installed (common on test devices) the app shows "No UPI app found..." (`openUpi` in `app/src/lib/booking.ts`). The lender can still tap "Received" to continue.
