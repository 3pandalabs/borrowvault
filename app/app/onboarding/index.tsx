import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, Empty, ErrorText, Field, Loading, P, Screen } from "../../src/components/ui";
import { useAuth } from "../../src/hooks/useAuth";
import { friendlyError, searchSocieties } from "../../src/lib/api";
import { colors } from "../../src/lib/theme";
import type { SocietySearchResult } from "../../src/lib/types";

export default function SocietySearch() {
  const router = useRouter();
  const { signOut, memberships } = useAuth();
  const [q, setQ] = useState("");
  const [fetched, setResults] = useState<SocietySearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        setResults(await searchSocieties(term));
        setError(null);
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const results = q.trim().length >= 2 ? fetched : null;
  const rejected = memberships.filter((m) => m.status === "rejected" || m.status === "revoked");

  return (
    <Screen>
      <P muted>
        BorrowVault works inside one gated society at a time. Find yours, then your society admin verifies your flat.
      </P>
      {rejected.map((m) => (
        <Card key={m.id} style={{ backgroundColor: colors.dangerSoft }}>
          <P>
            Your request for {m.societyName} ({m.towerName}-{m.flatNo}) was {m.status}. You can apply again with a clearer
            proof.
          </P>
        </Card>
      ))}
      <Field label="Society name" value={q} onChangeText={setQ} placeholder="e.g. Prestige Lakeside" autoFocus />
      <ErrorText>{error}</ErrorText>
      {loading ? <Loading /> : null}
      {results && !loading && results.length === 0 ? (
        <Empty title="No society found" body="Your society may not be on BorrowVault yet. Ask your society admin to get in touch." />
      ) : null}
      {results?.map((s) => (
        <Pressable
          key={s.id}
          onPress={() => router.push({ pathname: "/onboarding/join", params: { societyId: s.id, name: s.name } })}
        >
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Ionicons name="business" size={24} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.fg }}>{s.name}</Text>
                <Text style={{ color: colors.fgMuted }}>{s.city}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.fgMuted} />
            </View>
          </Card>
        </Pressable>
      ))}
      <Button title="Sign out" variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}
