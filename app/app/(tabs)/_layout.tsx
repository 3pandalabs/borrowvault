import { Ionicons } from "@expo/vector-icons";
import { Tabs, useFocusEffect } from "expo-router";
import { useCallback, useEffect } from "react";
import { usePolling } from "../../src/hooks/usePolling";
import { useUnread } from "../../src/hooks/useUnread";
import { badgeText } from "../../src/lib/chat";
import { refreshOffers, resetOffers, useOfferCount } from "../../src/lib/offers";
import { colors } from "../../src/lib/theme";

const OFFERS_POLL_MS = 60_000;

export default function TabsLayout() {
  const unread = useUnread();
  const { refresh } = unread;
  const offers = useOfferCount();
  // Coming back to the tabs (e.g. from a chat or a booking) refreshes the badges straight away.
  useFocusEffect(
    useCallback(() => {
      void refresh();
      void refreshOffers();
    }, [refresh]),
  );
  // Settlement offers waiting for me (bookings tab badge), polled while in the foreground.
  usePolling(refreshOffers, OFFERS_POLL_MS);
  useEffect(() => resetOffers, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerTintColor: colors.fg,
        headerTitleStyle: { fontWeight: "700" },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: "#9ca3af",
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Browse",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "search" : "search-outline"} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: "My bookings",
          tabBarBadge: badgeText(offers),
          tabBarBadgeStyle: { backgroundColor: colors.accent, fontSize: 11 },
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "calendar" : "calendar-outline"} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarBadge: badgeText(unread.total),
          tabBarBadgeStyle: { backgroundColor: colors.danger, fontSize: 11 },
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "chatbubbles" : "chatbubbles-outline"} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "person" : "person-outline"} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
