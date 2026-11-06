import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Chip, Empty, ErrorText } from "../../src/components/ui";
import { useLoader } from "../../src/hooks/useAsync";
import { useAuth } from "../../src/hooks/useAuth";
import { useIsScreenFocused, usePolling } from "../../src/hooks/usePolling";
import { useUnread } from "../../src/hooks/useUnread";
import { listConversations } from "../../src/lib/api";
import { formatWhen } from "../../src/lib/format";
import { colors, radius } from "../../src/lib/theme";
import type { ConversationSummary } from "../../src/lib/types";

export default function Messages() {
  const router = useRouter();
  const { user } = useAuth();
  const unread = useUnread();
  const { data, setData, error, loading, reload } = useLoader(listConversations, [user?.id]);
  const focused = useIsScreenFocused();

  // No push in Phase 1: keep the inbox fresh while it's on screen.
  usePolling(
    async () => {
      setData(await listConversations());
      await unread.refresh();
    },
    30_000,
    focused,
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={loading && !!data}
            onRefresh={() => {
              void reload();
              void unread.refresh();
            }}
          />
        }
        ListHeaderComponent={error ? <ErrorText>{error}</ErrorText> : null}
        ListEmptyComponent={
          loading ? null : (
            <Empty
              title="No messages yet"
              body={'Tap "Ask a question" on a listing, or "Message" on a booking, to chat with your neighbour.'}
            />
          )
        }
        renderItem={({ item }) => (
          <ConversationRow c={item} myId={user?.id} onPress={() => router.push(`/chat/${item.id}`)} />
        )}
      />
    </View>
  );
}

function ConversationRow({ c, myId, onPress }: { c: ConversationSummary; myId: string | undefined; onPress: () => void }) {
  const unread = c.unreadCount > 0;
  const when = c.lastMessageAt ?? c.lastMessage?.createdAt ?? null;
  const preview = c.lastMessage
    ? `${c.lastMessage.senderId === myId ? "You: " : ""}${c.lastMessage.body.replace(/\s+/g, " ")}`
    : "No messages yet";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Chat with ${c.other.displayName} about ${c.listing.title}${unread ? `, ${c.unreadCount} unread` : ""}`}
      style={({ pressed }) => [s.card, unread && { borderColor: colors.accent }, pressed && { opacity: 0.8 }]}
    >
      {c.listing.coverUrl ? (
        <Image source={{ uri: c.listing.coverUrl }} style={s.cover} />
      ) : (
        <View style={[s.cover, s.coverEmpty]}>
          <Ionicons name="cube-outline" size={22} color={colors.fgMuted} />
        </View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <View style={s.row}>
          <Text style={[s.name, unread && { fontWeight: "800" }]} numberOfLines={1}>
            {c.other.displayName}
          </Text>
          {when ? <Text style={[s.time, unread && { color: colors.accent }]}>{formatWhen(when)}</Text> : null}
        </View>
        <Text style={s.listing} numberOfLines={1}>
          {c.myRole === "owner" ? "Your listing · " : ""}
          {c.listing.title}
        </Text>
        <View style={s.row}>
          <Text style={[s.preview, unread && { color: colors.fg, fontWeight: "600" }]} numberOfLines={1}>
            {preview}
          </Text>
          {unread ? (
            <View style={s.badge}>
              <Text style={s.badgeText}>{c.unreadCount > 99 ? "99+" : c.unreadCount}</Text>
            </View>
          ) : null}
        </View>
        {c.activeBookingId ? <Chip label="Active booking" tone="info" /> : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: colors.card,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cover: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
  coverEmpty: { alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { fontSize: 15, fontWeight: "700", color: colors.fg, flex: 1 },
  time: { fontSize: 12, color: colors.fgMuted },
  listing: { fontSize: 13, color: colors.fgMuted },
  preview: { fontSize: 14, color: colors.fgMuted, flex: 1 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
});
