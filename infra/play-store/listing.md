# Play Console: store listing

Everything under **Grow users → Store presence → Main store listing**, plus the app details Play asks for when you create the app. Paste the text inside each code block as is. Character counts are Unicode characters (what Play counts), checked with `node` (see "How the counts were checked" at the end).

Language: **English (India), en-IN**, as the default listing. India first.

## App name (limit 30)

```
BorrowVault: Neighbour Rentals
```

**30 / 30 characters.**

"BorrowVault: Borrow from Neighbours" is 35 characters, so it does not fit. Other options that fit, if you prefer one:

| Name | Characters |
|---|---|
| `BorrowVault: Neighbour Rentals` (chosen) | 30 |
| `BorrowVault: Society Rentals` | 28 |
| `BorrowVault: Borrow & Lend` | 26 |

Why the chosen one: "rentals" is what people search for, "neighbour" says who you rent from, and it uses the Indian/British spelling the rest of the product uses. Play's metadata policy forbids words like "free", "best" or "#1" in the name, and this has none.

The app's on-device name stays "BorrowVault" (`app/app.json`); the store name can differ.

## Short description (limit 80)

```
Borrow and lend things and skills with verified neighbours. Pay directly by UPI.
```

**80 / 80 characters.**

## Full description (limit 4000)

```
BorrowVault lets neighbours in a gated society borrow and lend things, and offer small skills, safely.

Need a drill for an afternoon, a tent for the weekend, or a high chair for a visiting toddler? Someone a few floors away probably has one. BorrowVault helps you find it, agree on a price, pay by UPI and get it back in the same condition.

WHO IT'S FOR
• Residents of an apartment society or gated community in India that is registered on BorrowVault.
• You must be 18 or older.
• Your society admin checks your tower and flat before you can borrow or lend. Only approved residents of your society see your listings.
• If your society isn't on BorrowVault yet, a resident can apply to register it on our website.

WHAT YOU CAN SHARE
• Items: power tools, cameras, camping gear, baby gear, party supplies, kitchen appliances, sports equipment and more.
• Skills: baking, tutoring, pet sitting, furniture assembly and similar small jobs for neighbours.
• Set your own hourly, daily or weekend price, a deposit, and a checklist for what to check at handover.

HOW A BOOKING WORKS
1. Find an item and send a request for the dates you need. You can ask the owner a question in the chat first.
2. The owner accepts. You pay the rental fee in your own UPI app, straight to the owner's UPI ID.
3. At handover, both of you take photos of the item in the BorrowVault camera and tick the checklist.
4. At return, you take the same photos again. The owner compares them side by side and confirms.
5. Rate each other. Good ratings build your trust score.

PHOTO-CHECKED HANDOVERS
• Handover and return photos can only be taken with the in-app camera, not picked from your gallery.
• Each photo is time-stamped, checked against your society's location, and fingerprinted so it can't be swapped later.
• If something goes wrong, the photos and checklist are the record both sides agreed to.

PAYMENTS: UPI, DIRECTLY BETWEEN NEIGHBOURS
• You pay the owner directly through any UPI app. BorrowVault never holds, receives or moves your money.
• The owner confirms in the app when the money arrives.
• Your society chooses how deposits work: recorded in the app only, or paid by UPI and refunded by UPI.
• BorrowVault charges no platform fee right now.

IF THERE'S A PROBLEM
• Either side can raise a dispute with photos, for damage, missing parts, late return or an item not as described.
• The other side can respond or offer to settle.
• If you can't agree, a society admin decides. They must not be a party to the booking or live in either flat.
• Booking deadlines run automatically: unanswered requests expire, late returns get reminders, and unpaid refunds open a dispute.

CHAT AND NOTIFICATIONS
• Message the owner or borrower about a listing, and get a notification when they reply.
• You can turn chat notifications off in your profile.
• Report a message that breaks the rules. Your society admin reviews it.
• Messages can't be edited or deleted, because they may be needed in a dispute.

NEW (PILOT) SOCIETIES
A newly registered society starts as a pilot until our team verifies it. While it is a pilot:
• It can have up to 50 approved members.
• Deposits and replacement values are capped at ₹5,000 per listing.
• Our team rules on disputes instead of the society admin.
The limits are lifted once the society is verified.

YOUR PRIVACY
• We don't show ads and we don't sell your data.
• Your listings, name and flat are visible only to approved members of your society.
• We use your location only on the handover, return and dispute photo screens, to check photos were taken in your society. Never in the background.

BorrowVault is made by 3PandaLabs.
Terms: https://borrowvault.3pandalabs.com/terms
Privacy Policy: https://borrowvault.3pandalabs.com/privacy
Help: support@3pandalabs.com
```

**3,789 / 4,000 characters.**

Claims in the description and where they come from:

| Claim | Source |
|---|---|
| Admin checks tower and flat; only approved members see listings | `api/ROUTES.md` Societies & membership, "Society scoping" |
| Register a society on the website | `app/app/onboarding/index.tsx` ("Register it on the web") |
| Categories | `GET /categories` in `api/ROUTES.md` |
| Hourly / daily / weekend price, deposit, checklist | `POST /listings` in `api/ROUTES.md`; `app/app/listing/new.tsx` |
| In-app camera only, time-stamp, geofence, hash | `app/src/components/Evidence.tsx`, `POST /bookings/:id/media/presign` and `/finalize` |
| Never holds money, owner confirms, deposit modes | `CLAUDE.md` Phase 1 rules; `api/ROUTES.md` Payment |
| No platform fee | `platformFeePaise (0 in Phase 1)` in `api/ROUTES.md` |
| Arbiter can't be a party or live in a party's flat | `CLAUDE.md` invariants |
| Timers | `api/ROUTES.md` Timers |
| Chat push toggle, report, immutable messages | `api/ROUTES.md` Chat; `app/app/(tabs)/profile.tsx`; `app/app/chat/[id].tsx` |
| Pilot limits (50 members, ₹5,000, platform rules) | `api/ROUTES.md` Pilot societies |
| No ads, no data sale, location only at capture | `web/src/app/privacy/page.tsx`; `app/src/lib/location.ts` |

Wording deliberately avoided: "safe" as a guarantee, "insured", "escrow", "guaranteed refund", "best", "#1", any comparison with other apps.

## App category

**Category: Lifestyle** (App, not Game).

Why: BorrowVault is about everyday life in a residential community, and it is not a store selling goods (Shopping) or a general social network (Social).

CONFIRM: if you would rather be found next to classifieds and rental apps, **Shopping** is the alternative. Don't pick Finance: the app moves no money, and Finance invites extra financial-services review.

## Tags

Play lets you pick up to 5 tags from its fixed list (Store settings → App tags). Suggested, in order:

1. Rental
2. Community
3. Marketplace / Classifieds
4. Home & Family
5. Local services

CONFIRM: the tag list changes. Pick the closest matches the console offers for the Lifestyle category; skip any that aren't there.

## Store settings: contact details

| Field | Value |
|---|---|
| Email (required, public) | `support@3pandalabs.com` |
| Phone (optional, public) | leave empty |
| Website | `https://borrowvault.3pandalabs.com` |
| Privacy policy (App content → Privacy policy) | `https://borrowvault.3pandalabs.com/privacy` |
| External marketing | opt out (no need to advertise outside Play before launch) |

CONFIRM: that support@3pandalabs.com is a mailbox someone reads. Play shows it publicly and reviewers sometimes write to it.

## Graphics

| Asset | File | Play spec |
|---|---|---|
| App icon | `graphics/icon-512.png` | 512 × 512 PNG, up to 1 MB |
| Feature graphic | `graphics/feature-graphic.png` | 1024 × 500 PNG or JPEG |
| Phone screenshots | `screenshots/framed/*.png` | see `screenshots.md` |

How they are built: `tools/build-graphics.mjs` (see `README.md`).

## What's new (v1.0.0, limit 500)

```
First release of BorrowVault.
• Join your society and get verified by your society admin.
• List items and skills with your own price, deposit and checklist.
• Request bookings and pay the owner directly by UPI.
• Photo-checked handover and return with the in-app camera.
• Chat with notifications, ratings, and disputes decided by your society admin.
```

**351 / 500 characters.**

## How the counts were checked

```
node -e "const t=require('fs').readFileSync('listing.md','utf8');for(const m of t.matchAll(/^## (.+)\n(?:(?!\n## )[\s\S])*?\n\x60\x60\x60\n([\s\S]*?)\n\x60\x60\x60/gm))console.log([...m[2]].length, m[1])"
```

Run it in `infra/play-store/`. It prints the length of the first code block under each heading.
