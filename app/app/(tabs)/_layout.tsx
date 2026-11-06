import { Ionicons } from "@expo/vector-icons";
import { Tabs, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { useUnread } from "../../src/hooks/useUnread";
import { badgeText } from "../../src/lib/chat";
import { colors } from "../../src/lib/theme";

export default function TabsLayout() {
  const unread = useUnread();
  const { refresh } = unread;
  // Coming back to the tabs (e.g. from a chat) refreshes the badge straight away.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

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
