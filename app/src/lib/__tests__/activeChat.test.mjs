import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chatConversationId,
  clearActiveConversation,
  getActiveConversation,
  setActiveConversation,
  shouldPresent,
} from "../activeChat.ts";

test("chatConversationId reads only chat pushes", () => {
  assert.equal(chatConversationId({ type: "chat", conversationId: "c1" }), "c1");
  assert.equal(chatConversationId({ type: "booking", conversationId: "c1" }), null);
  assert.equal(chatConversationId({ type: "chat" }), null);
  assert.equal(chatConversationId({ type: "chat", conversationId: "" }), null);
  assert.equal(chatConversationId(null), null);
  assert.equal(chatConversationId("chat"), null);
});

test("a push for the open conversation is not presented; anything else is", () => {
  setActiveConversation("c1");
  assert.equal(shouldPresent({ type: "chat", conversationId: "c1" }), false);
  assert.equal(shouldPresent({ type: "chat", conversationId: "c2" }), true);
  assert.equal(shouldPresent({ type: "other" }), true);
  assert.equal(shouldPresent(undefined), true);
});

test("clearing only clears the matching conversation", () => {
  setActiveConversation("c2");
  clearActiveConversation("c1"); // an older screen blurring late
  assert.equal(getActiveConversation(), "c2");
  clearActiveConversation("c2");
  assert.equal(getActiveConversation(), null);
  assert.equal(shouldPresent({ type: "chat", conversationId: "c2" }), true);
});
