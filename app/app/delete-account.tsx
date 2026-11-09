import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text } from "react-native";
import { Button, Card, ErrorText, Field, H1, H2, Loading, P, Screen } from "../src/components/ui";
import { useLoader } from "../src/hooks/useAsync";
import { useAuth } from "../src/hooks/useAuth";
import { ApiError, deleteAccount, friendlyError, getDeletionCheck } from "../src/lib/api";
import { openWeb } from "../src/lib/openWeb";
import { blockerText, DELETE_ACCOUNT_WEB_URL } from "../src/lib/safety";
import { colors } from "../src/lib/theme";

/** Profile → Delete account (api/ROUTES.md "Account deletion"). */
export default function DeleteAccount() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const check = useLoader(getDeletionCheck, [user?.id]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(password);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.error === "wrong_password") {
        setError("That password isn't right.");
      } else if (err instanceof ApiError && err.status === 409) {
        setError("Something still needs finishing. See the list above.");
        void check.reload();
      } else {
        setError(friendlyError(err));
      }
      return;
    }
    // The server already ended every session, so the sign-out calls may fail; local sign-out still completes.
    try {
      await signOut();
    } catch {
      // tokens are cleared locally either way
    }
    Alert.alert("Account deleted", "Your BorrowVault account is gone. You can sign up again any time.");
  }

  function ask() {
    Alert.alert("Delete your account?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void confirmDelete() },
    ]);
  }

  const blockers = check.data?.blockers ?? [];

  return (
    <Screen onRefresh={check.reload} refreshing={check.loading}>
      <Stack.Screen options={{ title: "Delete account" }} />
      <H1>Delete your account</H1>
      <Card>
        <H2>What happens</H2>
        <P>• Your name, email, phone and UPI ID are removed.</P>
        <P>• Your listings are taken down and their photos deleted.</P>
        <P>• You leave all your societies. Your address proof and ID documents are deleted.</P>
        <P>• You are signed out on every device.</P>
        <P muted>
          Past bookings, disputes and chats are shared with your neighbours, so they stay. Your name on them changes to
          &quot;Deleted user&quot;. Handover and return photos are kept as evidence. You can sign up again later with
          the same email.
        </P>
      </Card>

      {check.loading && !check.data ? <Loading /> : null}
      <ErrorText>{check.error}</ErrorText>

      {blockers.length > 0 ? (
        <Card>
          <H2>Finish these first</H2>
          {blockers.map((b) => (
            <Pressable key={`${b.kind}-${b.bookingId}`} onPress={() => router.push(`/booking/${b.bookingId}`)} accessibilityRole="link">
              <Text style={{ color: colors.fg, paddingVertical: 6 }}>{`${blockerText(b)} ›`}</Text>
            </Pressable>
          ))}
          <P muted>Pull down to check again.</P>
        </Card>
      ) : null}

      {check.data?.canDelete ? (
        <Card>
          <Field
            label="Your password"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (error) setError(null);
            }}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
          />
          <ErrorText>{error}</ErrorText>
          <Button title="Delete my account" variant="danger" busy={busy} disabled={!password} onPress={ask} />
        </Card>
      ) : (
        <ErrorText>{error}</ErrorText>
      )}

      <P muted>{`You can also delete your account on the web at ${DELETE_ACCOUNT_WEB_URL}`}</P>
      <Button title="Open the web page" variant="ghost" icon="open-outline" onPress={() => void openWeb(DELETE_ACCOUNT_WEB_URL)} />
    </Screen>
  );
}
