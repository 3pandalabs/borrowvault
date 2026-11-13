import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { bookingPushId, chatConversationId } from "../lib/activeChat";
import { isNominationPush } from "../lib/nominations";
import { refreshOffers } from "../lib/offers";
import { useNominations } from "./useNominations";
import { useUnread } from "./useUnread";

/**
 * Push handling (api/ROUTES.md "Push notifications" + "Dispute notices"), mounted
 * once in the root layout. `ready` = signed in with an approved membership, i.e.
 * the chat and booking screens are reachable.
 * - A chat push arriving in the foreground refreshes the unread badge; a booking
 *   push (dispute response / accepted offer) refreshes the "offer waiting" badge;
 *   a co-admin nomination push refreshes the green Profile badge.
 * - Tapping one (warm, or the tap that cold-started the app) opens /chat/<id>,
 *   /booking/<id> or /admin-requests.
 * Whether a foreground push is shown at all is decided in lib/push.ts.
 */
export function usePushNotifications(ready: boolean) {
  const router = useRouter();
  const { refresh } = useUnread();
  const { refresh: refreshNominations } = useNominations();

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const data = n.request.content.data;
      if (chatConversationId(data)) void refresh();
      if (bookingPushId(data)) void refreshOffers();
      if (isNominationPush(data)) void refreshNominations();
    });
    return () => sub.remove();
  }, [refresh, refreshNominations]);

  useEffect(() => {
    if (!ready || Platform.OS === "web") return;
    const open = (r: Notifications.NotificationResponse | null) => {
      if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const data = r.notification.request.content.data;
      const chatId = chatConversationId(data);
      const bookingId = chatId ? null : bookingPushId(data);
      const nomination = !chatId && !bookingId && isNominationPush(data);
      if (!chatId && !bookingId && !nomination) return;
      // Handled: don't re-open it on the next mount / sign-in.
      Notifications.clearLastNotificationResponse();
      router.push(chatId ? `/chat/${chatId}` : bookingId ? `/booking/${bookingId}` : "/admin-requests");
    };
    // Cold start: the tap that launched the app. (getLastNotificationResponseAsync is
    // deprecated in SDK 57 in favour of this synchronous version.)
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [ready, router]);
}
