import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { deletePushToken, registerPushToken } from "./api";
import { shouldPresent } from "./activeChat";

// Push (api/ROUTES.md "/me/push-tokens" + Chat "Push notifications").
// Everything here is best effort: no push token (simulator, permission
// denied, no EAS projectId yet, offline) just means no pushes.

let cachedToken: string | null = null;
/** The user this device's token was last sent to the API for. */
let registeredFor: string | null = null;

// Foreground presentation: a chat push for the conversation already on screen
// is dropped (the chat shows the message itself); everything else shows.
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const show = shouldPresent(n.request.content.data);
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
  },
});

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  // Android 13+: a channel must exist before the permission prompt can appear.
  await Notifications.setNotificationChannelAsync("default", {
    name: "Bookings",
    importance: Notifications.AndroidImportance.HIGH,
  });
  // The API sends chat pushes with channelId "chat".
  await Notifications.setNotificationChannelAsync("chat", {
    name: "Messages",
    description: "New chat messages from neighbours",
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** Asks for permission and returns this device's Expo push token, or null. */
export async function getPushToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (!Device.isDevice) return null;
  try {
    await ensureChannels();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return null;
    const projectId =
      (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ?? Constants.easConfig?.projectId;
    if (!projectId) return null; // `eas init` not run yet: push simply stays off
    cachedToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return cachedToken;
  } catch {
    return null;
  }
}

/**
 * Registers this device for the signed-in user (POST /me/push-tokens).
 * Called on app start and sign-in; the API upserts, so repeating is harmless.
 */
export async function registerForPush(userId: string): Promise<void> {
  if (registeredFor === userId) return;
  const token = await getPushToken();
  if (!token || (Platform.OS !== "ios" && Platform.OS !== "android")) return;
  try {
    await registerPushToken(token, Platform.OS);
    registeredFor = userId;
  } catch {
    // offline or rate limited: the next app start tries again
  }
}

/** Sign-out: stop pushes to this device (DELETE /me/push-tokens). Call while still signed in. */
export async function unregisterForPush(): Promise<void> {
  const token = cachedToken;
  registeredFor = null;
  if (!token) return;
  try {
    await deletePushToken(token);
  } catch {
    // best effort: the next sign-in on this device reassigns the token anyway
  }
}
