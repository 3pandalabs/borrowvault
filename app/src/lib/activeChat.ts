// Which chat is on screen right now, so a push for it isn't shown as a banner
// (the open chat polls and shows the message itself). Pure: no React Native
// imports, so node --test can load it.

let activeConversationId: string | null = null;

/** The chat screen sets this on focus and clears it (with its own id) on blur. */
export function setActiveConversation(id: string | null): void {
  activeConversationId = id;
}

/** Clears only if `id` is still the active one (a newer chat screen may have taken over). */
export function clearActiveConversation(id: string): void {
  if (activeConversationId === id) activeConversationId = null;
}

export function getActiveConversation(): string | null {
  return activeConversationId;
}

/** `data` of a BorrowVault chat push (api/ROUTES.md "Push notifications") → its conversation id, else null. */
export function chatConversationId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { type?: unknown; conversationId?: unknown };
  return d.type === "chat" && typeof d.conversationId === "string" && d.conversationId ? d.conversationId : null;
}

/** Show a foreground notification unless it's a chat push for the conversation already open. */
export function shouldPresent(data: unknown, active: string | null = activeConversationId): boolean {
  const id = chatConversationId(data);
  return !(id && id === active);
}
