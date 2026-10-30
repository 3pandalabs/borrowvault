import { Link } from "expo-router";
import { useState } from "react";
import { Image, Text, View } from "react-native";
import { Button, ErrorText, Field, H1, P, Screen } from "../../src/components/ui";
import { useAuth } from "../../src/hooks/useAuth";
import { requestPasswordReset } from "../../src/lib/api";
import { colors } from "../../src/lib/theme";
import { isValidEmail } from "../../src/lib/validation";

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await signIn(email, password);
    setBusy(false);
    if (res.error) setError(res.error);
  }

  async function forgot() {
    if (!isValidEmail(email)) {
      setError("Enter your email above first.");
      return;
    }
    try {
      await requestPasswordReset(email.trim());
    } catch {
      // never reveal whether the account exists
    }
    setInfo("If that email has an account, we've sent a reset link. Open it on this phone: it takes you to the BorrowVault website to set a new password (link valid 30 min).");
  }

  return (
    <Screen edges={["top", "bottom"]}>
      <View style={{ alignItems: "center", marginTop: 32, marginBottom: 8, gap: 8 }}>
        <Image source={require("../../assets/icon.png")} style={{ width: 72, height: 72 }} />
        <H1>BorrowVault</H1>
        <P muted>Borrow and lend within your society</P>
      </View>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
      <ErrorText>{error}</ErrorText>
      {info ? <P muted>{info}</P> : null}
      <Button title="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
      <Button title="Forgot password?" variant="ghost" onPress={forgot} />
      <Text style={{ textAlign: "center", color: colors.fgMuted }}>
        New here?{" "}
        <Link href="/(auth)/sign-up" style={{ color: colors.accent, fontWeight: "700" }}>
          Create an account
        </Link>
      </Text>
      <Text style={{ textAlign: "center", color: colors.fgMuted, fontSize: 12, marginTop: 24 }}>BorrowVault | by 3PandaLabs</Text>
    </Screen>
  );
}
