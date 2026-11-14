import assert from "node:assert/strict";
import { test } from "node:test";
import { adminSocietyIds, flatLabel, isJoinRequestPush, joinRequestsHeadline, pendingTotal } from "../joinRequests.ts";

test("adminSocietyIds keeps approved admin memberships only, once each", () => {
  const list = [
    { societyId: "s1", role: "society_admin", status: "approved" },
    { societyId: "s2", role: "resident", status: "approved" },
    { societyId: "s3", role: "society_admin", status: "revoked" },
    { societyId: "s1", role: "society_admin", status: "approved" },
  ];
  assert.deepEqual(adminSocietyIds(list), ["s1"]);
  assert.deepEqual(adminSocietyIds(null), []);
});

test("pendingTotal sums counts", () => {
  assert.equal(pendingTotal({ s1: 2, s2: 3 }), 5);
  assert.equal(pendingTotal({}), 0);
});

test("joinRequestsHeadline pluralises", () => {
  assert.equal(joinRequestsHeadline(1), "1 resident waiting for approval");
  assert.equal(joinRequestsHeadline(4), "4 residents waiting for approval");
});

test("isJoinRequestPush", () => {
  assert.equal(isJoinRequestPush({ type: "join_request", societyId: "s", membershipId: "m" }), true);
  assert.equal(isJoinRequestPush({ type: "admin_nomination" }), false);
  assert.equal(isJoinRequestPush(undefined), false);
});

test("flatLabel", () => {
  assert.equal(flatLabel({ towerName: "A", flatNo: "101" }), "A-101");
  assert.equal(flatLabel({ towerName: null, flatNo: "101" }), "101");
  assert.equal(flatLabel({ towerName: null, flatNo: null }), "");
});
