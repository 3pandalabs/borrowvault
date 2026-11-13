import assert from "node:assert/strict";
import { test } from "node:test";
import { awaitingNominations, isNominationPush, nominationHeadline } from "../nominations.ts";

const row = (o) => ({ kind: "nominate_admin", status: "nominated", nominatedBy: { displayName: "Asha" }, societyName: "Lake View", ...o });

test("awaitingNominations keeps only nominations waiting for an answer", () => {
  const list = [row(), row({ status: "pending" }), row({ kind: "join_admin", status: "pending" }), row({ status: "declined" })];
  assert.deepEqual(awaitingNominations(list), [list[0]]);
  assert.deepEqual(awaitingNominations(null), []);
});

test("nominationHeadline names the nominator and the society", () => {
  assert.equal(nominationHeadline(row()), "Asha nominated you as a co-admin of Lake View");
  assert.equal(nominationHeadline(row({ nominatedBy: null })), "An admin of your society nominated you as a co-admin of Lake View");
});

test("isNominationPush", () => {
  assert.equal(isNominationPush({ type: "admin_nomination", requestId: "r1" }), true);
  assert.equal(isNominationPush({ type: "chat", conversationId: "c" }), false);
  assert.equal(isNominationPush(null), false);
});
