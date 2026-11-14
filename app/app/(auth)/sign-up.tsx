import { Link } from "expo-router";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { Button, ErrorText, Field, H1, P, Screen } from "../../src/components/ui";
import { useAuth } from "../../src/hooks/useAuth";
import { openWeb } from "../../src/lib/openWeb";
import { colors } from "../../src/lib/theme";
import { suggestEmail } from "../../src/lib/emailTypo";
import { isValidEmail, normalisePhone } from "../../src/lib/validation";
import { privacyUrl, termsUrl } from "../../src/lib/web";

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
  // Non-blocking typo guard (gmail.coma, gmial.com ...): a tap-to-fix hint only.
  const emailSuggestion = suggestEmail(email);
  // Explicit consent (DPDP). Client-side only: the signup API is unchanged.
  const [agreed, setAgreed] = useState(false);

  async function submit() {
    setTouched(true);
    if (!valid) return;
    if (!agreed) {
      setError("Please confirm you're 18 or older and agree to the Terms and Privacy Policy.");
      return;
    }
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
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        hint="We'll send a link to confirm it."
        error={touched ? errors.email : null}
      />
      {emailSuggestion ? (
        <Text style={{ color: colors.warn, marginTop: -6, marginBottom: 12 }} accessibilityLiveRegion="polite">
          {"Did you mean "}
          <Text
            style={{ color: colors.accent, fontWeight: "700", textDecorationLine: "underline" }}
            onPress={() => setEmail(emailSuggestion)}
            accessibilityRole="button"
          >
            {emailSuggestion}
          </Text>
          ?
        </Text>
      ) : null}
      <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98765 43210" error={touched ? errors.phone : null} />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry error={touched ? errors.password : null} />
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 12 }}>
        <Pressable
          onPress={() => setAgreed((a) => !a)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel="I am 18 or older and agree to the Terms and Privacy Policy"
          hitSlop={8}
        >
          <Ionicons name={agreed ? "checkbox" : "square-outline"} size={22} color={colors.accent} />
        </Pressable>
        <Text style={{ flex: 1, color: colors.fgMuted }}>
          {"I am 18 or older, and I agree to the "}
          <Text style={{ color: colors.accent, fontWeight: "700" }} onPress={() => void openWeb(termsUrl())}>
            Terms
          </Text>
          {" and "}
          <Text style={{ color: colors.accent, fontWeight: "700" }} onPress={() => void openWeb(privacyUrl())}>
            Privacy Policy
          </Text>
          {", including the use of my data as described there."}
        </Text>
      </View>
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
