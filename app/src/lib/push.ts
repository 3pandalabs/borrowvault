import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

let cachedToken: string | null = null;

/**
 * Registers for push and returns the Expo push token (or null).
 *
 * TODO(api contract): ROUTES.md has no route for storing a device push token
 * (e.g. `POST /me/push-tokens {token, platform}`). Until the contract adds one,
 * the token is only obtained and kept in memory; it is deliberately NOT sent
 * to the API. Also needs the EAS projectId in app.json (created later).
 */
export async function registerForPush(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (!Device.isDevice) return null;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Bookings",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId) return null; // EAS project not created yet
    cachedToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return cachedToken;
  } catch {
    return null;
  }
}
