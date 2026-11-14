import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Chip, ChipRow, Empty, ErrorText, FREE_GREEN, FreeBadge, TrustBadge } from "../../src/components/ui";
import { VerifyEmailBanner } from "../../src/components/VerifyEmailBanner";
import { useLoader } from "../../src/hooks/useAsync";
import { useAuth } from "../../src/hooks/useAuth";
import { getCategories, listListings } from "../../src/lib/api";
import { formatPaise } from "../../src/lib/format";
import { priceLine } from "../../src/lib/labels";
import { colors, radius } from "../../src/lib/theme";
import type { CategoryPreset, ListingKind, ListingSummary } from "../../src/lib/types";

export default function Browse() {
  const router = useRouter();
  const { approved, user } = useAuth();
  const [pickedSociety, setSocietyId] = useState(approved[0]?.societyId ?? "");
  // Fall back to the first approved society if the picked one disappears (revoked).
  const societyId = approved.some((m) => m.societyId === pickedSociety) ? pickedSociety : (approved[0]?.societyId ?? "");
  const [kind, setKind] = useState<ListingKind>("item");
  const [category, setCategory] = useState<string | null>(null);
  const [onlyFree, setOnlyFree] = useState(false);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [categories, setCategories] = useState<CategoryPreset[]>([]);

  useEffect(() => {
    getCategories().then(setCategories).catch(() => setCategories([]));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, error, loading, reload } = useLoader(
    () =>
      listListings({ societyId, kind, category: category ?? undefined, q: debouncedQ || undefined, free: onlyFree ? "1" : undefined }),
    [societyId, kind, category, debouncedQ, onlyFree],
  );

  const cats = categories.filter((c) => c.kind === kind);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={s.header}>
        <VerifyEmailBanner />
        {approved.length > 1 ? (
          <ChipRow>
            {approved.map((m) => (
              <Chip key={m.societyId} label={m.societyName} selected={m.societyId === societyId} onPress={() => setSocietyId(m.societyId)} />
            ))}
          </ChipRow>
        ) : (
          <Text style={s.society}>
            <Ionicons name="business" size={14} color={colors.accent} /> {approved[0]?.societyName}
            {approved[0]?.societyTier === "pilot" ? " · Pilot society" : ""}
          </Text>
        )}
        <View style={s.segment}>
          {(["item", "skill"] as const).map((k) => (
            <Pressable
              key={k}
              style={[s.segBtn, kind === k && s.segOn]}
              onPress={() => {
                setKind(k);
                setCategory(null);
              }}
            >
              <Text style={[s.segText, kind === k && { color: colors.accentFg }]}>{k === "item" ? "Items" : "Skills"}</Text>
            </Pressable>
          ))}
        </View>
        <View style={s.search}>
          <Ionicons name="search" size={18} color={colors.fgMuted} />
          <TextInput
            style={{ flex: 1, fontSize: 15, color: colors.fg, paddingVertical: 8 }}
            value={q}
            onChangeText={setQ}
            placeholder={kind === "item" ? "Search drills, strollers, cameras…" : "Search tutoring, repairs, cooking…"}
            placeholderTextColor="#a1a1aa"
            returnKeyType="search"
          />
        </View>
        <ChipRow>
          <Chip label={onlyFree ? "✓ Free only" : "Free"} tone={onlyFree ? undefined : "good"} selected={onlyFree} onPress={() => setOnlyFree((f) => !f)} />
          <Chip label="All" selected={!category} onPress={() => setCategory(null)} />
          {cats.map((c) => (
            <Chip key={c.key} label={c.label} selected={category === c.key} onPress={() => setCategory(c.key)} />
          ))}
        </ChipRow>
      </View>
      <FlatList
        data={data ?? []}
        keyExtractor={(l) => l.id}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}
        ListHeaderComponent={error ? <ErrorText>{error}</ErrorText> : null}
        ListEmptyComponent={
          loading ? null : (
            <Empty
              title={`No ${onlyFree ? "free " : ""}${kind === "item" ? "items" : "skills"} yet`}
              body="Be the first in your society to list something."
            />
          )
        }
        renderItem={({ item }) => <ListingCard l={item} mine={item.owner?.id === user?.id} onPress={() => router.push(`/listing/${item.id}`)} />}
      />
      <View style={s.fab}>
        <Button
          title="List something"
          icon="add"
          onPress={() => router.push({ pathname: "/listing/new", params: { societyId, kind } })}
        />
      </View>
    </View>
  );
}

function ListingCard({ l, mine, onPress }: { l: ListingSummary; mine: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.card, l.isFree && s.cardFree]}>
      <View>
        {l.coverUrl ? (
          <Image source={{ uri: l.coverUrl }} style={s.cover} />
        ) : (
          <View style={[s.cover, { alignItems: "center", justifyContent: "center" }]}>
            <Ionicons name={l.kind === "item" ? "cube-outline" : "construct-outline"} size={28} color={colors.fgMuted} />
          </View>
        )}
        {l.isFree ? <FreeBadge style={{ position: "absolute", top: 4, left: 4 }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.title} numberOfLines={2}>
          {l.title}
        </Text>
        {l.isFree ? (
          <Text style={[s.price, { color: FREE_GREEN }]}>{l.kind === "skill" ? "Offered for free" : "Free to borrow"}</Text>
        ) : (
          <Text style={s.price}>{priceLine(l)}</Text>
        )}
        {l.depositPaise > 0 ? <Text style={s.meta}>Deposit {formatPaise(l.depositPaise)}</Text> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {l.owner ? (
            <Text style={s.meta} numberOfLines={1}>
              {mine ? "You" : l.owner.displayName}
              {l.owner.towerName ? ` · ${l.owner.towerName}-${l.owner.flatNo}` : ""}
            </Text>
          ) : null}
          <TrustBadge trust={l.owner?.trust} />
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  header: { padding: 16, paddingBottom: 4, gap: 10, backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  society: { fontSize: 14, fontWeight: "700", color: colors.fg },
  segment: { flexDirection: "row", backgroundColor: colors.bgSubtle, borderRadius: radius.md, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: radius.sm },
  segOn: { backgroundColor: colors.accent },
  segText: { fontWeight: "700", color: colors.fg },
  search: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12 },
  card: { flexDirection: "row", gap: 12, backgroundColor: colors.card, padding: 12, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  cardFree: { borderWidth: 2, borderColor: FREE_GREEN },
  cover: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
  title: { fontSize: 16, fontWeight: "700", color: colors.fg },
  price: { fontSize: 14, fontWeight: "700", color: colors.accent },
  meta: { fontSize: 12, color: colors.fgMuted },
  fab: { position: "absolute", right: 16, bottom: 16 },
});
