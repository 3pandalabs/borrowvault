import { useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, StyleSheet, Text, TextInput, View } from "react-native";
import { blockUser, reportListing, reportUser, safetyError, unblockUser } from "../lib/api";
import { LISTING_REPORT_REASONS, REPORT_DETAILS_MAX, USER_REPORT_REASONS } from "../lib/safety";
import { colors, radius } from "../lib/theme";
import type { ListingReportReason, UserReportReason } from "../lib/types";
import { Button, Chip, ErrorText, P } from "./ui";

export type ReportTarget =
  | { type: "user"; id: string; name: string }
  | { type: "listing"; id: string; name: string };

/** Report a user or a listing: a reason from the API enum plus optional details. */
export function ReportModal({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasons = target?.type === "listing" ? LISTING_REPORT_REASONS : USER_REPORT_REASONS;

  function close() {
    setReason(null);
    setDetails("");
    setError(null);
    onClose();
  }

  async function submit() {
    if (!target || !reason) return;
    setBusy(true);
    setError(null);
    try {
      const d = details.trim() || undefined;
      if (target.type === "user") await reportUser(target.id, reason as UserReportReason, d);
      else await reportListing(target.id, reason as ListingReportReason, d);
      close();
      Alert.alert("Reported", "Thanks. Your society admins will review it.");
    } catch (err) {
      setError(safetyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.title}>{target?.type === "listing" ? "Report this listing" : `Report ${target?.name ?? ""}`}</Text>
          <P muted>
            {target?.type === "listing"
              ? "Your society admins will see the listing and your reason. They can remove it."
              : "Your society admins and the BorrowVault team will see your report."}
          </P>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {reasons.map((r) => (
              <Chip key={r.key} label={r.label} selected={reason === r.key} onPress={() => setReason(r.key)} />
            ))}
          </View>
          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder="Add details (optional)"
            placeholderTextColor="#a1a1aa"
            multiline
            maxLength={REPORT_DETAILS_MAX}
            style={s.input}
            accessibilityLabel="Details"
          />
          <ErrorText>{error}</ErrorText>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} disabled={busy} onPress={close} />
            <Button title="Report" variant="danger" style={{ flex: 1 }} busy={busy} disabled={!reason} onPress={() => void submit()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Asks first, then blocks. Resolves true once blocked. */
export function confirmBlock(user: { id: string; displayName: string }): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      `Block ${user.displayName}?`,
      "You won't be able to message each other or start new bookings. You won't see each other's listings. Bookings you already have carry on.",
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: "Block",
          style: "destructive",
          onPress: () => {
            blockUser(user.id)
              .then(() => resolve(true))
              .catch((err) => {
                Alert.alert("Couldn't block", safetyError(err));
                resolve(false);
              });
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Unblocks; resolves true on success (shows an alert on failure). */
export async function doUnblock(userId: string): Promise<boolean> {
  try {
    await unblockUser(userId);
    return true;
  } catch (err) {
    Alert.alert("Couldn't unblock", safetyError(err));
    return false;
  }
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 16 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, gap: 10 },
  title: { fontSize: 16, fontWeight: "700", color: colors.fg },
  input: {
    minHeight: 80,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
    fontSize: 15,
    color: colors.fg,
    backgroundColor: colors.bgSubtle,
  },
});
