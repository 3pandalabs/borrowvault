import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { Button, Card, H1, P, Screen } from "../../src/components/ui";
import { useAuth } from "../../src/hooks/useAuth";
import { formatDateTime } from "../../src/lib/format";
import { colors } from "../../src/lib/theme";

const POLL_MS = 15_000;

export default function Pending() {
  const { memberships, approved, refresh, signOut } = useAuth();
  const router = useRouter();
  const pending = memberships.filter((m) => m.status === "pending");

  // Poll GET /me until the admin acts.
  useEffect(() => {
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (approved.length > 0) router.replace("/(tabs)");
    else if (pending.length === 0) router.replace("/onboarding");
  }, [approved.length, pending.length, router]);

  return (
    <Screen onRefresh={() => void refresh()}>
      <View style={{ alignItems: "center", gap: 8, marginTop: 24 }}>
        <Ionicons name="hourglass-outline" size={48} color={colors.accent} />
        <H1>Waiting for approval</H1>
        <P muted style={{ textAlign: "center" }}>
          Your society admin checks your flat and proof. This page refreshes on its own; we&apos;ll also notify you.
        </P>
      </View>
      {pending.map((m) => (
        <Card key={m.id}>
          <P style={{ fontWeight: "700" }}>{m.societyName}</P>
          <P muted>
            {m.towerName} · Flat {m.flatNo} · {m.occupancy}
          </P>
          <P muted>Requested {formatDateTime(m.createdAt)}</P>
        </Card>
      ))}
      <Button title="Check now" variant="secondary" onPress={() => void refresh()} />
      <Button title="Sign out" variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}
