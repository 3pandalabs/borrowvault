# Phone screenshots: shot list

Capture these from the **real app** during pilot testing, using the reviewer/demo accounts in Demo Heights (`app-access.md`), never a real resident's account.

## Play's rules

- **2 to 8** phone screenshots; aim for all 8. The first 3 show most often, so they carry the story.
- PNG or JPEG, no alpha needed, up to 8 MB each.
- Each side **320 px to 3,840 px**, and the long side **no more than twice** the short side. 16:9 landscape or 9:16 portrait is the safe choice.
- Most phones capture at about 20:9 (for example 1080 × 2400), which **breaks the 2:1 rule**. The framing script below fixes that: it outputs 1080 × 1920 (9:16).
- No misleading content: what's shown must be in the app. Captions are fine. Don't add device frames of a specific phone brand, "#1" or award badges, or prices that aren't real.
- For promotion on Play (recommended): at least 4 screenshots, 1080 px or more on the short side.

## How to capture on Android

1. Phone in portrait, light mode (the app is light only), language English.
2. Status bar: full battery icon and a neutral time help; turn on Do Not Disturb so no notifications appear. On Android 12+ you can also use Developer options → **System UI demo mode** for a clean status bar.
3. Open the screen, wait until images have loaded, then press **Power + Volume Down** together.
4. Files land in `Pictures/Screenshots` on the phone. Copy them to `infra/play-store/screenshots/raw/` named exactly as below (`01-browse.png`, ...). That folder is gitignored.

From a computer with USB debugging on instead: `adb exec-out screencap -p > 01-browse.png`.

## Data on screen (no real personal data)

- Accounts: "Play Reviewer" (B-901) and "Demo Lender" (A-202) in Demo Heights. Any other names must be invented and clearly fake ("Asha Demo", "Ravi Demo").
- Listings with "(demo)" in the title are fine on screen, but for nicer shots create clean copies without "(demo)" in a **separate demo account** and archive them after.
- Photos: your own item photos or royalty-free images, with no faces, house numbers, car plates, documents or anything identifying.
- **Never show:** a real UPI ID, phone number, email, address proof, ID document, or a real resident's name or flat.
- UPI IDs on screen: `borrowvault-demo@invalid` style only.

## The 8 shots

| # | File | Screen and state | What must be visible | Caption |
|---|---|---|---|---|
| 1 | `01-browse.png` | **Browse** tab, signed in as Play Reviewer, Demo Heights | 4–6 listings with cover photos and ₹ prices (mix of items and one skill); owners' names and flats like "A-202" | Borrow from verified neighbours in your society |
| 2 | `02-listing.png` | **Listing** detail of the drill (another resident's listing) | Photos, ₹/day price, deposit, "Checked at handover & return" checklist, "Request to book" with dates picked, "Ask a question" button | See the price, deposit and what gets checked |
| 3 | `03-pay-upi.png` | **Booking** detail, borrower view, state Accepted (next action: pay) | "Pay fee ₹… via UPI" button, the optional UTR field, "I've paid", the timeline | Pay your neighbour directly by UPI |
| 4 | `04-handover-camera.png` | **Handover inspection** screen with one photo slot already taken and the checklist half answered | Photo slots ("Front", "Side"), the "inside society" geofence chip, checklist toggles | Photo-checked handover with the in-app camera |
| 5 | `05-return-review.png` | **Review return side-by-side**, lender view | Handover photo next to return photo for the same slot, checklist answers from both phases | Compare handover and return side by side |
| 6 | `06-chat.png` | **Chat** between borrower and owner about a listing | 4–6 friendly messages ("Is the drill free on Saturday?" / "Yes, pick it up at 10"), listing title at the top | Ask the owner before you borrow |
| 7 | `07-new-listing.png` | **New listing** form, half filled | "What are you offering?" item/skill switch, category, ₹ price fields, a listing photo or two | Lend an item or offer a skill in minutes |
| 8 | `08-verified.png` | **Your flat** join screen (onboarding/join) with tower and flat filled, or Profile → My societies showing "Approved" | Tower/flat, occupancy, "Address proof" card (empty, or a generic icon; no real document) | Every member is verified against a real flat |

Alternatives if a shot is hard to get: **Profile** showing trust score and "My listings"; **Rate** screen with stars and "Punctual / Careful / As described"; **My bookings** list with a few states.

Captions are already in `screenshots/captions.json`. Change them there.

## Frame them (optional, recommended)

```
cd infra/play-store/tools
npm install
npm run frame
```

For every `screenshots/raw/NN-name.png` this writes `screenshots/framed/NN-name.png`: 1080 × 1920, dark brand background, a brand-gradient strip on top, the caption in white (Geist, converted to outlines, so no system fonts are needed), and the screenshot below with rounded corners. Upload the files from `framed/`. Commit `framed/` if you want them in the repo; `raw/` is ignored.

Only PNG input is supported (Android screenshots are PNG).
