import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Image, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatTime } from "../lib/format";
import { colors, radius } from "../lib/theme";
import type { Media } from "../lib/types";
import { slotTitle } from "./Evidence";

/** Read-only evidence thumbnails with a full-screen viewer (presigned GET URLs, 10 min). */
export function MediaGrid({ media }: { media: Media[] }) {
  const [open, setOpen] = useState<Media | null>(null);
  return (
    <>
      <View style={s.grid}>
        {media.map((m) => (
          <Pressable
            key={m.id}
            style={s.cell}
            onPress={() => (m.mime.startsWith("video/") ? void Linking.openURL(m.url) : setOpen(m))}
          >
            {m.mime.startsWith("image/") ? (
              <Image source={{ uri: m.url }} style={s.img} />
            ) : (
              <View style={[s.img, { alignItems: "center", justifyContent: "center" }]}>
                <Ionicons name="play-circle" size={32} color={colors.fgMuted} />
              </View>
            )}
            <Text style={s.label} numberOfLines={1}>
              {slotTitle(m.slot)}
            </Text>
            <Text style={s.time}>{formatTime(m.receivedAt)}</Text>
            {m.noLocation || !m.withinGeofence || m.clockSkewFlag ? (
              <Text style={s.flag} numberOfLines={2}>
                {[m.noLocation ? "no location" : !m.withinGeofence ? "outside society" : null, m.clockSkewFlag ? "clock skew" : null].filter(Boolean).join(" · ")} ⚠
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <SafeAreaView style={s.viewer}>
          <Pressable style={s.close} onPress={() => setOpen(null)} accessibilityLabel="Close">
            <Ionicons name="close" size={30} color="#fff" />
          </Pressable>
          {open ? <Image source={{ uri: open.url }} style={{ flex: 1 }} resizeMode="contain" /> : null}
          {open ? <Text style={s.viewerLabel}>{slotTitle(open.slot)}</Text> : null}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: { width: "31%" },
  img: { aspectRatio: 1, width: "100%", borderRadius: radius.md, backgroundColor: colors.bgSubtle },
  label: { fontSize: 12, fontWeight: "700", color: colors.fg, marginTop: 2 },
  time: { fontSize: 11, color: colors.fgMuted },
  flag: { fontSize: 11, color: colors.warn, fontWeight: "600" },
  viewer: { flex: 1, backgroundColor: "#000" },
  close: { alignSelf: "flex-end", padding: 12 },
  viewerLabel: { color: "#fff", textAlign: "center", padding: 12, fontSize: 16, fontWeight: "700" },
});
