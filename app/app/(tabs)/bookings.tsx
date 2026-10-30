import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Countdown, Empty, ErrorText, StateBadge } from "../../src/components/ui";
import { useLoader } from "../../src/hooks/useAsync";
import { listBookings } from "../../src/lib/api";
import { formatDateTime, formatPaise } from "../../src/lib/format";
import { isWaiting, nextActionLabel } from "../../src/lib/labels";
import { colors, radius } from "../../src/lib/theme";
import type { Booking } from "../../src/lib/types";

const DONE = new Set(["COMPLETED", "RESOLVED", "DECLINED", "EXPIRED", "CANCELLED"]);

export default function Bookings() {
  const router = useRouter();
  const [role, setRole] = useState<"borrower" | "lender">("borrower");
  const { data, error, loading, reload } = useLoader(() => listBookings({ role }), [role]);

  // Things needing me first, then live, then finished.
  const sorted = (data ?? []).slice().sort((a, b) => rank(a) - rank(b) || (a.deadlineAt ?? a.startsAt).localeCompare(b.deadlineAt ?? b.startsAt));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={s.segmentWrap}>
        <View style={s.segment}>
          {(["borrower", "lender"] as const).map((r) => (
            <Pressable key={r} style={[s.segBtn, role === r && s.segOn]} onPress={() => setRole(r)}>
              <Text style={[s.segText, role === r && { color: colors.accentFg }]}>{r === "borrower" ? "Borrowing" : "Lending"}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <FlatList
        data={sorted}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}
        ListHeaderComponent={error ? <ErrorText>{error}</ErrorText> : null}
        ListEmptyComponent={loading ? null : <Empty title="No bookings yet" body={role === "borrower" ? "Browse your society to borrow something." : "Requests for your listings show up here."} />}
        renderItem={({ item }) => <BookingRow b={item} onPress={() => router.push(`/booking/${item.id}`)} />}
      />
    </View>
  );
}

function rank(b: Booking) {
  if (DONE.has(b.state) && !b.nextAction) return 3;
  if (!isWaiting(b.nextAction)) return 0;
  return DONE.has(b.state) ? 2 : 1;
}

function BookingRow({ b, onPress }: { b: Booking; onPress: () => void }) {
  const other = b.myRole === "lender" ? b.borrower : b.lender;
  const action = nextActionLabel(b);
  const mine = !isWaiting(b.nextAction);
  return (
    <Pressable onPress={onPress} style={[s.card, mine && { borderColor: colors.accent, borderWidth: 1.5 }]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Text style={s.title} numberOfLines={1}>
          {b.listing.title}
        </Text>
        <StateBadge state={b.state} />
      </View>
      <Text style={s.meta}>
        {b.myRole === "lender" ? "To" : "From"} {other.displayName} · {other.towerName}-{other.flatNo}
      </Text>
      <Text style={s.meta}>
        {formatDateTime(b.startsAt)} → {formatDateTime(b.endsAt)} · {formatPaise(b.feePaise)}
      </Text>
      {action ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Ionicons name={mine ? "arrow-forward-circle" : "hourglass-outline"} size={16} color={mine ? colors.accent : colors.fgMuted} />
          <Text style={[s.action, mine && { color: colors.accent }]}>{action}</Text>
          <Countdown to={b.deadlineAt} prefix="in" />
        </View>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  segmentWrap: { padding: 16, paddingBottom: 0 },
  segment: { flexDirection: "row", backgroundColor: colors.bgSubtle, borderRadius: radius.md, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: radius.sm },
  segOn: { backgroundColor: colors.accent },
  segText: { fontWeight: "700", color: colors.fg },
  card: { backgroundColor: colors.card, padding: 14, borderRadius: radius.lg, gap: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  title: { fontSize: 16, fontWeight: "700", color: colors.fg, flex: 1 },
  meta: { fontSize: 13, color: colors.fgMuted },
  action: { fontSize: 14, fontWeight: "700", color: colors.fgMuted },
});
