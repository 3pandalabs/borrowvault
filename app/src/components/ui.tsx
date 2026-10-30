import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNow } from "../hooks/useAsync";
import { formatCountdown, formatStateLabel } from "../lib/format";
import { colors, radius } from "../lib/theme";
import type { BookingState, Trust } from "../lib/types";

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  footer,
  edges = ["bottom"],
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  edges?: ("top" | "bottom")[];
}) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollBody}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={styles.h1}>{children}</Text>;
}

export function H2({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.h2Row}>
      <Text style={styles.h2}>{children}</Text>
      {right}
    </View>
  );
}

export function P({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[styles.p, muted && { color: colors.fgMuted }, style]}>{children}</Text>;
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  title,
  onPress,
  disabled,
  busy,
  variant = "primary",
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: ButtonVariant;
  icon?: ComponentProps<typeof Ionicons>["name"];
  style?: ViewStyle;
}) {
  const v = buttonVariants[variant];
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border },
        off && { opacity: 0.45 },
        pressed && !off && { opacity: 0.8 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={18} color={v.fg} /> : null}
          <Text style={[styles.buttonText, { color: v.fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.accent, fg: colors.accentFg, border: colors.accent },
  secondary: { bg: colors.card, fg: colors.fg, border: colors.border },
  danger: { bg: colors.card, fg: colors.danger, border: colors.danger },
  ghost: { bg: "transparent", fg: colors.accent, border: "transparent" },
};

export function Field({
  label,
  hint,
  error,
  ...props
}: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor="#a1a1aa"
        {...props}
        style={[styles.input, props.multiline && { minHeight: 80, textAlignVertical: "top" }, error ? { borderColor: colors.danger } : null, props.style]}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Chip({
  label,
  selected,
  onPress,
  tone,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: "good" | "warn" | "bad" | "info";
}) {
  const t = tone ? toneColors[tone] : null;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.chip,
        selected && { backgroundColor: colors.accent, borderColor: colors.accent },
        t && { backgroundColor: t.bg, borderColor: t.bg },
      ]}
    >
      <Text style={[styles.chipText, selected && { color: colors.accentFg }, t && { color: t.fg }]}>{label}</Text>
    </Pressable>
  );
}

const toneColors = {
  good: { bg: colors.accentSoft, fg: colors.accent },
  warn: { bg: colors.warnSoft, fg: colors.warn },
  bad: { bg: colors.dangerSoft, fg: colors.danger },
  info: { bg: colors.infoSoft, fg: colors.info },
};

export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
      {children}
    </ScrollView>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <View style={styles.errorBox}>
      <Ionicons name="alert-circle" size={16} color={colors.danger} />
      <Text style={styles.errorText}>{children}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ padding: 32, alignItems: "center" }}>
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <View style={{ padding: 32, alignItems: "center" }}>
      <Text style={[styles.h2, { textAlign: "center" }]}>{title}</Text>
      {body ? <P muted style={{ textAlign: "center", marginTop: 4 }}>{body}</P> : null}
    </View>
  );
}

export function KV({ k, v, warn }: { k: string; v: ReactNode; warn?: boolean }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={[styles.kvVal, warn && { color: colors.warn, fontWeight: "700" }]}>{v}</Text>
    </View>
  );
}

export function TrustBadge({ trust }: { trust: Trust | undefined | null }) {
  if (!trust) return null;
  const low = trust.score < 3 || trust.completed < 1;
  return (
    <View style={[styles.trust, low && { backgroundColor: colors.bgSubtle }]}>
      <Ionicons name="star" size={12} color={low ? colors.fgMuted : "#ca8a04"} />
      <Text style={styles.trustText}>
        {trust.completed > 0 ? trust.score.toFixed(1) : "New"} ({trust.completed})
      </Text>
      {trust.disputesLost > 0 ? <Text style={[styles.trustText, { color: colors.danger }]}> · {trust.disputesLost} lost</Text> : null}
    </View>
  );
}

const STATE_TONE: Partial<Record<BookingState, "good" | "warn" | "bad" | "info">> = {
  REQUESTED: "info",
  ACCEPTED: "info",
  DEPOSIT_HELD: "info",
  HANDOVER_PENDING: "warn",
  ACTIVE: "good",
  OVERDUE: "bad",
  RETURN_PENDING: "warn",
  COMPLETED: "good",
  DISPUTED: "bad",
  RESOLVED: "good",
};

export function StateBadge({ state }: { state: BookingState }) {
  return <Chip label={formatStateLabel(state)} tone={STATE_TONE[state] ?? undefined} />;
}

/** Live countdown to an ISO deadline. */
export function Countdown({ to, prefix, overdueText = "Time's up" }: { to: string | null; prefix?: string; overdueText?: string }) {
  const now = useNow(1000);
  if (!to) return null;
  const ms = new Date(to).getTime() - now;
  const urgent = ms < 60 * 60 * 1000;
  return (
    <View style={[styles.countdown, urgent && { backgroundColor: colors.warnSoft }]}>
      <Ionicons name="time-outline" size={14} color={urgent ? colors.warn : colors.fgMuted} />
      <Text style={[styles.countdownText, urgent && { color: colors.warn }]}>
        {ms <= 0 ? overdueText : `${prefix ? `${prefix} ` : ""}${formatCountdown(ms)}`}
      </Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollBody: { padding: 16, paddingBottom: 120, gap: 12 },
  footer: {
    padding: 16,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 8,
  },
  h1: { fontSize: 24, fontWeight: "800", color: colors.fg },
  h2Row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h2: { fontSize: 16, fontWeight: "700", color: colors.fg },
  p: { fontSize: 14, color: colors.fg, lineHeight: 20 },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  buttonInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  buttonText: { fontSize: 15, fontWeight: "700" },
  label: { fontSize: 13, fontWeight: "600", color: colors.fgMuted, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.fg,
    backgroundColor: colors.card,
  },
  hint: { fontSize: 12, color: colors.fgMuted, marginTop: 4 },
  fieldError: { fontSize: 12, color: colors.danger, marginTop: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignSelf: "flex-start",
  },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.fg },
  errorBox: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    backgroundColor: colors.dangerSoft,
    padding: 10,
    borderRadius: radius.sm,
  },
  errorText: { color: colors.danger, fontSize: 13, flex: 1 },
  kv: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, gap: 12 },
  kvKey: { color: colors.fgMuted, fontSize: 14 },
  kvVal: { color: colors.fg, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  trust: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#fef9c3",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  trustText: { fontSize: 12, fontWeight: "700", color: colors.fg },
  countdown: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.bgSubtle,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  countdownText: { fontSize: 12, fontWeight: "700", color: colors.fgMuted },
});
