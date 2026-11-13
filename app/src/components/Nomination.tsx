import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { colors, radius } from "../lib/theme";

/** Green box with the shield icon, for a co-admin nomination waiting for the user. */
export function NominationBox({ title, kicker, children }: { title: string; kicker?: string; children?: ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.accentSoft,
        borderColor: colors.accent,
        borderWidth: 1.5,
        borderRadius: radius.lg,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="shield-checkmark" size={20} color={colors.accentFg} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          {kicker ? (
            <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>
              {kicker}
            </Text>
          ) : null}
          <Text style={{ color: colors.fg, fontSize: 16, fontWeight: "700", lineHeight: 22 }}>{title}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

/** Small green count pill, e.g. next to "My admin requests". */
export function GreenCount({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <View
      accessibilityLabel={`${n} nomination${n > 1 ? "s" : ""} waiting for you`}
      style={{
        minWidth: 20,
        height: 20,
        paddingHorizontal: 6,
        borderRadius: 10,
        backgroundColor: colors.accent,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: colors.accentFg, fontSize: 12, fontWeight: "700" }}>{n > 99 ? "99+" : n}</Text>
    </View>
  );
}
