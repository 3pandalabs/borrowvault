// Copy for account deletion, blocking and reports (api/ROUTES.md "Account
// deletion", "Users: blocking and reporting"). Pure: `npm test` loads it.

import type { DeletionBlocker, ListingReportReason, UserReportReason } from "./types";

/** Public page Google Play lists as the account-deletion URL. */
export const DELETE_ACCOUNT_WEB_URL = "https://borrowvault.3pandalabs.com/delete-account";

export const USER_REPORT_REASONS: readonly { key: UserReportReason; label: string }[] = [
  { key: "harassment", label: "Harassment" },
  { key: "spam", label: "Spam" },
  { key: "scam", label: "Scam or fraud" },
  { key: "inappropriate", label: "Inappropriate" },
  { key: "other", label: "Something else" },
];

export const LISTING_REPORT_REASONS: readonly { key: ListingReportReason; label: string }[] = [
  { key: "prohibited_item", label: "Not allowed here" },
  { key: "misleading", label: "Misleading" },
  { key: "offensive", label: "Offensive" },
  { key: "scam", label: "Scam or fraud" },
  { key: "other", label: "Something else" },
];

export const REPORT_DETAILS_MAX = 1000;

/** One plain line per thing the user must finish before deleting their account. */
export function blockerText(b: DeletionBlocker): string {
  const t = b.listingTitle ? `"${b.listingTitle}"` : "a booking";
  switch (b.kind) {
    case "live_booking":
      return `Finish or cancel the booking for ${t}.`;
    case "open_dispute":
      return `Wait for the dispute on ${t} to be settled.`;
    case "unpaid_award":
      return `Settle the dispute award on ${t}.`;
    case "refund_owed":
      return `Finish the refund on ${t}.`;
  }
}
