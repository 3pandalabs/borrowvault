import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/hooks/useAuth";
import { colors } from "../src/lib/theme";

function RootNavigation() {
  const { user, memberships, approved, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const group = segments[0] as string | undefined;
    const inAuth = group === "(auth)";
    const inOnboarding = group === "onboarding";

    if (!user) {
      if (!inAuth) router.replace("/(auth)/sign-in");
      return;
    }
    if (approved.length === 0) {
      // Not yet a verified resident anywhere: only onboarding is reachable.
      const pending = memberships.some((m) => m.status === "pending");
      if (!inOnboarding) router.replace(pending ? "/onboarding/pending" : "/onboarding");
      return;
    }
    if (inAuth) router.replace("/(tabs)");
  }, [user, memberships, approved.length, isLoading, segments, router]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.fg,
        headerTitleStyle: { fontWeight: "700" },
        headerStyle: { backgroundColor: colors.card },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RootNavigation />
        <StatusBar style="dark" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
