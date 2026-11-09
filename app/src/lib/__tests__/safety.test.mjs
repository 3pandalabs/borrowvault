import assert from "node:assert/strict";
import { test } from "node:test";
import { blockerText, DELETE_ACCOUNT_WEB_URL, LISTING_REPORT_REASONS, USER_REPORT_REASONS } from "../safety.ts";

test("report reasons match the API enums", () => {
  assert.deepEqual(
    USER_REPORT_REASONS.map((r) => r.key),
    ["harassment", "spam", "scam", "inappropriate", "other"],
  );
  assert.deepEqual(
    LISTING_REPORT_REASONS.map((r) => r.key),
    ["prohibited_item", "misleading", "offensive", "scam", "other"],
  );
});

test("every deletion blocker kind has copy", () => {
  for (const kind of ["live_booking", "open_dispute", "unpaid_award", "refund_owed"]) {
    const text = blockerText({ kind, bookingId: "b", listingTitle: "Drill", state: "ACTIVE" });
    assert.ok(text.includes('"Drill"'), kind);
  }
});

test("deletion web URL is the public page", () => {
  assert.equal(DELETE_ACCOUNT_WEB_URL, "https://borrowvault.3pandalabs.com/delete-account");
});
