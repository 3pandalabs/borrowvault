import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { chatConversationId } from "../lib/activeChat";
import { useUnread } from "./useUnread";

/**
 * Chat push handling (api/ROUTES.md "Push notifications"), mounted once in the
 * root layout. `ready` = signed in with an approved membership, i.e. the chat
 * screens are reachable.
 * - A chat push arriving in the foreground refreshes the unread badge.
 * - Tapping one (warm, or the tap that cold-started the app) opens /chat/<id>.
 * Whether a foreground push is shown at all is decided in lib/push.ts.
 */
export function usePushNotifications(ready: boolean) {
  const router = useRouter();
  const { refresh } = useUnread();

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Notifications.addNotificationReceivedListener((n) => {
      if (chatConversationId(n.request.content.data)) void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (!ready || Platform.OS === "web") return;
    const open = (r: Notifications.NotificationResponse | null) => {
      if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const id = chatConversationId(r.notification.request.content.data);
      if (!id) return;
      // Handled: don't re-open it on the next mount / sign-in.
      Notifications.clearLastNotificationResponse();
      router.push(`/chat/${id}`);
    };
    // Cold start: the tap that launched the app. (getLastNotificationResponseAsync is
    // deprecated in SDK 57 in favour of this synchronous version.)
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [ready, router]);
}
