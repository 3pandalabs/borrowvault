import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/hooks/useAuth";
import { usePushNotifications } from "../src/hooks/usePushNotifications";
import { JoinRequestsProvider } from "../src/hooks/useJoinRequests";
import { NominationsProvider } from "../src/hooks/useNominations";
import { UnreadProvider } from "../src/hooks/useUnread";
import { initCrashReporting, setCrashUser, wrapRoot } from "../src/lib/crash";
import { colors } from "../src/lib/theme";

initCrashReporting();

function RootNavigation() {
  const { user, memberships, approved, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  usePushNotifications(!isLoading && !!user && approved.length > 0);
  useEffect(() => setCrashUser(user?.id ?? null), [user?.id]);

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
      // Account deletion must be reachable before approval too (Play policy).
      if (!inOnboarding && group !== "delete-account") router.replace(pending ? "/onboarding/pending" : "/onboarding");
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

function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <UnreadProvider>
          <NominationsProvider>
            <JoinRequestsProvider>
              <RootNavigation />
              <StatusBar style="dark" />
            </JoinRequestsProvider>
          </NominationsProvider>
        </UnreadProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
export default wrapRoot(RootLayout);
