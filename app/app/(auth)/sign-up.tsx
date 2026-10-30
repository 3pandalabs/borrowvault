import { Link } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { Button, ErrorText, Field, H1, P, Screen } from "../../src/components/ui";
import { useAuth } from "../../src/hooks/useAuth";
import { colors } from "../../src/lib/theme";
import { isValidEmail, normalisePhone } from "../../src/lib/validation";

export default function SignUp() {
  const { signUp } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const phoneN = normalisePhone(phone);
  const errors = {
    displayName: displayName.trim().length < 2 ? "Enter your name" : null,
    email: !isValidEmail(email) ? "Enter a valid email" : null,
    phone: !phoneN ? "Enter a 10-digit Indian mobile number" : null,
    password: password.length < 8 ? "At least 8 characters" : null,
  };
  const valid = !Object.values(errors).some(Boolean);

  async function submit() {
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setError(null);
    const res = await signUp({ email: email.trim(), password, displayName: displayName.trim(), phone: phoneN! });
    setBusy(false);
    if (res.error) setError(res.error);
  }

  return (
    <Screen edges={["top", "bottom"]}>
      <H1>Create your account</H1>
      <P muted>Next, you&apos;ll tell us your society and flat so your society admin can verify you.</P>
      <Field label="Full name" value={displayName} onChangeText={setDisplayName} autoComplete="name" error={touched ? errors.displayName : null} />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" error={touched ? errors.email : null} />
      <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98765 43210" error={touched ? errors.phone : null} />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry error={touched ? errors.password : null} />
      <ErrorText>{error}</ErrorText>
      <Button title="Create account" onPress={submit} busy={busy} />
      <Text style={{ textAlign: "center", color: colors.fgMuted }}>
        Already have an account?{" "}
        <Link href="/(auth)/sign-in" style={{ color: colors.accent, fontWeight: "700" }}>
          Sign in
        </Link>
      </Text>
    </Screen>
  );
}
