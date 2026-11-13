// Expo push token storage (api/ROUTES.md "POST/DELETE /me/push-tokens").
// Route and push tests mock this module (no Postgres in the unit run).

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { pushTokens, users } from "../db/schema.js";

export type PushPlatform = "ios" | "android";

/** `ExponentPushToken[...]` or `ExpoPushToken[...]`, nothing else. */
export const EXPO_PUSH_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]\s]{1,200}\]$/;

/**
 * Upsert on token: re-registering refreshes last_seen_at, and a token that
 * was registered to another user moves to this one (one device, one account).
 * Exported separately so a unit test can assert the SQL without a database.
 */
export function upsertTokenQuery(userId: string, token: string, platform: PushPlatform) {
  return db
    .insert(pushTokens)
    .values({ userId, token, platform })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId, platform, lastSeenAt: sql`now()` },
    });
}

export async function upsertToken(userId: string, token: string, platform: PushPlatform): Promise<void> {
  await upsertTokenQuery(userId, token, platform);
}

/** Deletes the token only if it belongs to this user. */
export async function deleteToken(userId: string, token: string): Promise<void> {
  await db.delete(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
}

/** Every token of the user (password reset; any future sign-out-everywhere / account deletion). */
export async function deleteTokensOf(userId: string): Promise<void> {
  await db.delete(pushTokens).where(eq(pushTokens.userId, userId));
}

/** Tokens the push service reported as DeviceNotRegistered. */
export async function deleteTokens(tokens: string[]): Promise<void> {
  if (tokens.length) await db.delete(pushTokens).where(inArray(pushTokens.token, tokens));
}

/** Where to push for this user: [] when they turned chat push off (or don't exist). */
export async function chatPushTargets(userId: string): Promise<string[]> {
  const rows = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .innerJoin(users, eq(users.id, pushTokens.userId))
    .where(and(eq(pushTokens.userId, userId), eq(users.chatPushEnabled, true)));
  return rows.map((r) => r.token);
}

/**
 * Every token of the user, NOT gated by chatPushEnabled (that switch is about chat):
 * booking notices (dispute response, accepted offer) and account events (a co-admin
 * nomination). [] for a deleted account (its tokens are deleted anyway).
 */
export async function bookingPushTargets(userId: string): Promise<string[]> {
  const rows = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .innerJoin(users, eq(users.id, pushTokens.userId))
    .where(and(eq(pushTokens.userId, userId), isNull(users.deletedAt)));
  return rows.map((r) => r.token);
}
