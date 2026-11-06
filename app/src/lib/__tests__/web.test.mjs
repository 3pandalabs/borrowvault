import assert from "node:assert/strict";
import { test } from "node:test";
import { adminRequestUrl, registerSocietyUrl, WEB_URL } from "../web.ts";

test("web links point at the BorrowVault web app", () => {
  assert.equal(WEB_URL, "https://borrowvault.3pandalabs.com");
  assert.equal(registerSocietyUrl(), "https://borrowvault.3pandalabs.com/societies/register");
  assert.equal(
    adminRequestUrl("3f2a9c1e-0000-4000-8000-000000000001"),
    "https://borrowvault.3pandalabs.com/admin-requests/new?societyId=3f2a9c1e-0000-4000-8000-000000000001",
  );
  assert.equal(adminRequestUrl("a&b"), "https://borrowvault.3pandalabs.com/admin-requests/new?societyId=a%26b");
});
