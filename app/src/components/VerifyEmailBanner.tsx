import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../hooks/useAuth";
import { ApiError, friendlyError, resendVerificationEmail } from "../lib/api";
import { colors, radius } from "../lib/theme";

/**
 * "Verify your email" while the account's address is unconfirmed (api/ROUTES.md
 * "Email verification"). Renders nothing once verified. useAuth re-fetches /me
 * when the app returns to the foreground, so it clears after the browser link.
 */
export function VerifyEmailBanner() {
  const { user, refresh, signOut } = useAuth();
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  if (!user || user.emailVerified) return null;

  async function resend() {
    setState("busy");
    setError(null);
    try {
      await resendVerificationEmail();
      setState("sent");
    } catch (err) {
      setState("idle");
      if (err instanceof ApiError && err.error === "email_already_verified") {
        void refresh();
        return;
      }
      setError(friendlyError(err));
    }
  }

  return (
    <View style={styles.box} accessibilityRole="summary">
      <View style={styles.row}>
        <Ionicons name="mail-unread-outline" size={20} color={colors.warn} />
        <Text style={styles.title}>Verify your email</Text>
      </View>
      <Text style={styles.body}>
        We sent a link to <Text style={styles.email}>{user.email}</Text>. Open it to join your society. Check spam if
        you can&apos;t find it.
      </Text>
      <View style={styles.actions}>
        {state === "sent" ? (
          <Text style={styles.sent}>Sent. Check your inbox.</Text>
        ) : (
          <Pressable onPress={resend} disabled={state === "busy"} accessibilityRole="button" hitSlop={8}>
            {state === "busy" ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.link}>Resend</Text>}
          </Pressable>
        )}
        <Pressable onPress={() => void refresh()} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.link}>I&apos;ve verified</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => void signOut()} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.muted}>Wrong address? Sign out and sign up again</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.warnSoft,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 12,
    gap: 6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontWeight: "700", color: colors.fg, fontSize: 15 },
  body: { color: colors.fg, lineHeight: 20 },
  email: { fontWeight: "700" },
  actions: { flexDirection: "row", gap: 20, alignItems: "center", marginTop: 2 },
  link: { color: colors.accent, fontWeight: "700" },
  sent: { color: colors.accent },
  muted: { color: colors.fgMuted, textDecorationLine: "underline" },
  error: { color: colors.danger },
});
