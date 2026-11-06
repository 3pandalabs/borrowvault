import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendNewer,
  badgeText,
  codePointLength,
  hasIncoming,
  messageProblem,
  prependOlder,
  reportReasonOk,
  visibleMessages,
} from "../chat.ts";

const m = (id, senderId = "me") => ({ id, senderId, body: id, createdAt: "2026-11-06T00:00:00.000Z" });
const ids = (list) => list.map((x) => x.id);

test("code points, not UTF-16 units", () => {
  assert.equal(codePointLength("hello"), 5);
  assert.equal(codePointLength("👍🏽"), 2);
  assert.equal("👍".length, 2);
  assert.equal(codePointLength("👍"), 1);
  assert.equal(codePointLength("नमस्ते"), 6);
});

test("messageProblem trims and enforces 1–2000 code points", () => {
  assert.equal(messageProblem("   \n "), "empty");
  assert.equal(messageProblem(" hi "), null);
  assert.equal(messageProblem("a".repeat(2000)), null);
  assert.equal(messageProblem("a".repeat(2001)), "too_long");
  // 2000 emoji = 4000 UTF-16 units but still allowed
  assert.equal(messageProblem("😀".repeat(2000)), null);
  assert.equal(messageProblem(`  ${"a".repeat(2000)}  `), null);
});

test("report reason is 5–500 after trimming", () => {
  assert.equal(reportReasonOk("  abc  "), false);
  assert.equal(reportReasonOk("abuse"), true);
  assert.equal(reportReasonOk("x".repeat(500)), true);
  assert.equal(reportReasonOk("x".repeat(501)), false);
});

test("appendNewer keeps server order and drops ids already held", () => {
  const held = [m("1"), m("2")];
  assert.deepEqual(ids(appendNewer(held, [m("2"), m("3"), m("4")])), ["1", "2", "3", "4"]);
  assert.equal(appendNewer(held, []), held);
  assert.equal(appendNewer(held, [m("1"), m("2")]), held);
});

test("appendNewer never re-sorts by createdAt", () => {
  const late = { ...m("b"), createdAt: "2020-01-01T00:00:00.000Z" };
  assert.deepEqual(ids(appendNewer([m("a")], [late])), ["a", "b"]);
});

test("prependOlder puts an older page in front", () => {
  assert.deepEqual(ids(prependOlder([m("3"), m("4")], [m("1"), m("2"), m("3")])), ["1", "2", "3", "4"]);
  const held = [m("1")];
  assert.equal(prependOlder(held, []), held);
});

test("visibleMessages shows sent-but-unpolled messages after the confirmed ones", () => {
  const confirmed = [m("1"), m("2", "them")];
  assert.deepEqual(ids(visibleMessages(confirmed, [m("9")])), ["1", "2", "9"]);
  // Once a poll returns it (after the other person's message), it is shown in server order, once.
  const polled = appendNewer(confirmed, [m("3", "them"), m("9")]);
  assert.deepEqual(ids(visibleMessages(polled, [m("9")])), ["1", "2", "3", "9"]);
  assert.equal(visibleMessages(confirmed, []), confirmed);
});

test("hasIncoming ignores my own messages", () => {
  assert.equal(hasIncoming([m("1", "me")], "me"), false);
  assert.equal(hasIncoming([m("1", "me"), m("2", "them")], "me"), true);
  assert.equal(hasIncoming([], "me"), false);
});

test("badgeText", () => {
  assert.equal(badgeText(0), undefined);
  assert.equal(badgeText(3), "3");
  assert.equal(badgeText(120), "99+");
});

test("formatWhen is compact and in IST", async () => {
  const { formatWhen } = await import("../format.ts");
  const now = new Date("2026-11-06T12:00:00.000Z"); // 5:30 PM IST, Fri 6 Nov
  assert.equal(formatWhen("2026-11-06T04:35:00.000Z", now), "10:05 AM");
  // 20:00 UTC on the 5th is already the 6th in IST
  assert.equal(formatWhen("2026-11-05T20:00:00.000Z", now), "1:30 AM");
  assert.equal(formatWhen("2026-11-02T06:00:00.000Z", now), "Mon 2 Nov");
  assert.equal(formatWhen("2025-11-02T06:00:00.000Z", now), "2 Nov 2025");
});
