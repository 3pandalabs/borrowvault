import { Stack } from "expo-router";
import { colors } from "../../src/lib/theme";

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.fg,
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Find your society" }} />
      <Stack.Screen name="join" options={{ title: "Your flat" }} />
      <Stack.Screen name="pending" options={{ title: "Verification", headerBackVisible: false }} />
    </Stack>
  );
}
