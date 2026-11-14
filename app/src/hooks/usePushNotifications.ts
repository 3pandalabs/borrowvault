import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { bookingPushId, chatConversationId } from "../lib/activeChat";
import { isJoinRequestPush } from "../lib/joinRequests";
import { isNominationPush } from "../lib/nominations";
import { refreshOffers } from "../lib/offers";
import { useJoinRequests } from "./useJoinRequests";
import { useNominations } from "./useNominations";
import { useUnread } from "./useUnread";

/**
 * Push handling (api/ROUTES.md "Push notifications" + "Dispute notices"), mounted
 * once in the root layout. `ready` = signed in with an approved membership, i.e.
 * the chat and booking screens are reachable.
 * - A chat push arriving in the foreground refreshes the unread badge; a booking
 *   push (dispute response / accepted offer) refreshes the "offer waiting" badge;
 *   a co-admin nomination or join-request push refreshes the green Profile badge.
 * - Tapping one (warm, or the tap that cold-started the app) opens /chat/<id>,
 *   /booking/<id>, /admin-requests or /admin/join-requests.
 * Whether a foreground push is shown at all is decided in lib/push.ts.
 */
export function usePushNotifications(ready: boolean) {
  const router = useRouter();
  const { refresh } = useUnread();
  const { refresh: refreshNominations } = useNominations();
  const { refresh: refreshJoinRequests } = useJoinRequests();

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const data = n.request.content.data;
      if (chatConversationId(data)) void refresh();
      if (bookingPushId(data)) void refreshOffers();
      if (isNominationPush(data)) void refreshNominations();
      if (isJoinRequestPush(data)) void refreshJoinRequests();
    });
    return () => sub.remove();
  }, [refresh, refreshNominations, refreshJoinRequests]);

  useEffect(() => {
    if (!ready || Platform.OS === "web") return;
    const open = (r: Notifications.NotificationResponse | null) => {
      if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const data = r.notification.request.content.data;
      const chatId = chatConversationId(data);
      const bookingId = chatId ? null : bookingPushId(data);
      const nomination = !chatId && !bookingId && isNominationPush(data);
      const joinRequest = !chatId && !bookingId && !nomination && isJoinRequestPush(data);
      if (!chatId && !bookingId && !nomination && !joinRequest) return;
      // Handled: don't re-open it on the next mount / sign-in.
      Notifications.clearLastNotificationResponse();
      router.push(
        chatId ? `/chat/${chatId}` : bookingId ? `/booking/${bookingId}` : joinRequest ? "/admin/join-requests" : "/admin-requests",
      );
    };
    // Cold start: the tap that launched the app. (getLastNotificationResponseAsync is
    // deprecated in SDK 57 in favour of this synchronous version.)
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [ready, router]);
}
