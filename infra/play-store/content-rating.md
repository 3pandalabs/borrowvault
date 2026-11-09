# Play Console: content rating, target audience, ads

## Content rating (IARC questionnaire)

**App content → Content rating → Start questionnaire.**

Email for the IARC certificate: `support@3pandalabs.com`.

### Category

The IARC categories are: Game; Social Networking, Forums, Blogs and UGC Sharing; Reference, News or Educational; Consumer Store or Commercial Streaming; Entertainment; Utility, Productivity, Communication or Other.

Suggested: **Social Networking, Forums, Blogs, and UGC Sharing**. Residents post listings with photos and text, chat with each other and rate each other. IARC's guidance is that any app whose main content comes from users belongs here, and choosing a category with fewer questions risks a rating being revoked later.

CONFIRM: if the console offers "Utility, Productivity, Communication, or Other" and you'd rather frame it as a tool, that's the fallback. Either way, answer the user-interaction questions "Yes".

### Likely answers

| Topic | Answer | Reasoning |
|---|---|---|
| Violence (any depiction) | No | No such content from us. Listings for weapons, replicas that look real, etc. are forbidden (Terms section 6). |
| Fear / horror | No | |
| Sexuality / nudity | No | Adult services are forbidden (Terms section 6). |
| Language (profanity, crude humour) | No | No such content from us; user chat is covered by the interaction questions. |
| Controlled substances (drugs, alcohol, tobacco) | No | Listing drugs, alcohol, tobacco or vapes is forbidden (Terms section 6). |
| Gambling: simulated or real-money | No | |
| Does the app contain or promote real-money gambling, loot boxes, contests? | No | |
| Crude humour, discrimination | No | |
| **Can users interact or exchange content with each other?** | **Yes** | Lender ↔ borrower chat, listings with photos, ratings and comments. |
| Is user-to-user communication moderated? | Partly | Message reporting goes to society admins (`POST /messages/:id/report`). No automatic filtering. See launch risks in `README.md`. |
| **Does the app share the user's current physical location with other users?** | **No** | Coordinates go to our server only. Other users see "inside / outside the society" on a photo, not the coordinates (`Media` in `api/ROUTES.md` has `withinGeofence`, no lat/lng). They do see your tower and flat, which is your home address, but not your live location. CONFIRM: if the questionnaire wording is "shares personal information such as address with other users", answer **Yes** because of tower + flat. |
| Does the app allow users to buy digital goods? | No | No in-app purchases; rentals are paid outside the app by UPI between residents. |
| Does the app contain ads? | No | |
| Unrestricted internet access (browser) | No | No in-app browser. The app hands our own website pages (Terms, Privacy, admin requests, password reset) to the phone's browser (`app/src/lib/openWeb.ts`, `app/src/lib/web.ts`), and `upi://` links to the user's UPI app. |

### Expected rating

With "users interact" and nothing else ticked, IARC usually gives the lowest age tier plus an interactive-elements notice:

- IARC generic (used for India and most of Play): **3+**, with **"Users Interact"**.
- ESRB: Everyone, "Users Interact". PEGI: 3. USK: 0, with interactive-features notice.
- Some regions (e.g. ClassInd in Brazil, Korea's GRAC) may set a higher age for chat apps.

CONFIRM: the actual certificate after you submit. The content rating is a content label, not a promise that kids may use it. Who it's for is set separately in Target audience below.

## Target audience and content

**App content → Target audience and content.**

| Question | Answer |
|---|---|
| Target age groups | **18 and over only.** Leave every younger band unticked. |
| Could your app unintentionally appeal to children? | **No.** Plain utility design, no cartoon characters, no games; it requires society verification by an adult admin. |
| Store presence: does the listing appeal to children? | No. |

Matches the product: Terms section 2 says users must be 18+, the Privacy Policy section 11 says the same, and sign-up requires ticking "I am 18 or older and agree to the Terms and Privacy Policy" (`app/app/(auth)/sign-up.tsx`).

Because the audience excludes under-13s, the Families policy and its SDK requirements don't apply.

## Ads

**App content → Ads → "No, my app does not contain ads."**

Checked: no ad SDKs in `app/package.json` (no AdMob, Meta Audience Network, Unity Ads, AppLovin, etc.), no ad views in `app/`, and the Privacy Policy says "we don't use it for advertising".

## Analytics SDKs

**None found.** `app/package.json` has only Expo modules, React Native and small community libraries (AsyncStorage, NetInfo, datetime picker). No Firebase Analytics, Google Analytics, Sentry, Crashlytics, Amplitude, Mixpanel, Segment, AppsFlyer or Branch. The only Google SDK in the build is Firebase Cloud Messaging, through `expo-notifications`, used for chat push. The Privacy Policy also says "We don't use advertising or analytics cookies."
