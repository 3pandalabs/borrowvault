import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Image, Linking, Pressable, Text, View } from "react-native";
import { Button, Card, Chip, Empty, ErrorText, Field, H2, Loading, P, Screen } from "../../src/components/ui";
import { useLoader } from "../../src/hooks/useAsync";
import { useAuth } from "../../src/hooks/useAuth";
import { useJoinRequests } from "../../src/hooks/useJoinRequests";
import {
  approveMembership,
  friendlyError,
  getStorageUrl,
  listSocietyMemberships,
  membershipReviewError,
  rejectMembership,
} from "../../src/lib/api";
import { formatDateTime } from "../../src/lib/format";
import { adminSocietyIds, flatLabel } from "../../src/lib/joinRequests";
import { colors, radius } from "../../src/lib/theme";
import type { AdminMembership } from "../../src/lib/types";

const OCCUPANCY: Record<string, string> = { owner: "Owner", tenant: "Tenant", family: "Family member" };

/**
 * Society admins: residents waiting for approval, per society they admin
 * (api/ROUTES.md "Join request notice"; GET /admin/societies/:id/memberships?status=pending,
 * POST /admin/memberships/:id/approve|reject).
 */
export default function JoinRequests() {
  const { memberships } = useAuth();
  const ids = adminSocietyIds(memberships);
  const names = new Map(memberships.map((m) => [m.societyId, m.societyName]));
  const { refresh: refreshBadge } = useJoinRequests();

  const list = useLoader(
    async () => {
      const rows = await Promise.all(ids.map((id) => listSocietyMemberships(id, "pending")));
      return ids.map((id, i) => ({ societyId: id, rows: rows[i] }));
    },
    [ids.join(",")],
  );

  // Keep the Profile badge in step with what this screen shows.
  useEffect(() => {
    if (list.data) void refreshBadge();
  }, [list.data, refreshBadge]);

  function removeRow(id: string) {
    list.setData((cur) => cur?.map((g) => ({ ...g, rows: g.rows.filter((r) => r.id !== id) })) ?? cur);
  }

  const total = list.data?.reduce((a, g) => a + g.rows.length, 0) ?? 0;

  return (
    <Screen refreshing={list.loading && !!list.data} onRefresh={() => void list.reload()}>
      <Stack.Screen options={{ title: "Join requests" }} />
      <P muted>
        Residents asking to join your society. Check their proof against the flat they named before you approve. Declined
        residents can apply again.
      </P>
      <ErrorText>{list.error}</ErrorText>
      {!list.data && list.loading ? <Loading /> : null}
      {ids.length === 0 ? <Empty title="You're not a society admin" body="Only society admins review join requests." /> : null}
      {list.data && ids.length > 0 && total === 0 ? (
        <Empty
          title="No one waiting for approval"
          body="Share an invite code on your society's WhatsApp group or notice board to bring residents in."
        />
      ) : null}
      {list.data?.map((g) =>
        g.rows.length === 0 ? null : (
          <View key={g.societyId} style={{ gap: 12 }}>
            {ids.length > 1 ? <H2>{names.get(g.societyId) ?? "Society"}</H2> : null}
            {g.rows.map((m) => (
              <RequestCard key={m.id} m={m} onDone={() => removeRow(m.id)} />
            ))}
          </View>
        ),
      )}
    </Screen>
  );
}

function RequestCard({ m, onDone }: { m: AdminMembership; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flat = flatLabel(m);
  // Only BorrowVault can decline an admin's membership (403 admin_membership_platform_only).
  const canDecline = m.role !== "society_admin";

  async function act(kind: "approve" | "reject") {
    setBusy(kind);
    setError(null);
    try {
      const n = note.trim() || undefined;
      await (kind === "approve" ? approveMembership(m.id, n) : rejectMembership(m.id, n));
      onDone();
    } catch (e) {
      setError(membershipReviewError(e));
    } finally {
      setBusy(null);
    }
  }

  function decline() {
    Alert.alert(
      `Decline ${m.user?.displayName || "this resident"}?`,
      note.trim() ? "They'll be emailed your note and can apply again." : "They'll be told by email and can apply again. You can add a note first.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Decline", style: "destructive", onPress: () => void act("reject") },
      ],
    );
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Text style={{ fontWeight: "700", fontSize: 16, color: colors.fg, flex: 1 }}>{m.user?.displayName || "Resident"}</Text>
        {m.role === "society_admin" ? <Chip label="Admin" tone="info" /> : null}
      </View>
      <P muted>
        {flat ? `${flat} · ` : ""}
        {OCCUPANCY[m.occupancy] ?? m.occupancy} · asked {formatDateTime(m.createdAt)}
      </P>
      <Proof proofKey={m.proofKey} />
      <Field
        label="Note (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="Emailed to the resident"
        maxLength={1000}
        multiline
      />
      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button title="Approve" icon="checkmark" busy={busy === "approve"} disabled={!!busy} onPress={() => void act("approve")} style={{ flex: 1 }} />
        {canDecline ? (
          <Button title="Decline" icon="close" variant="danger" busy={busy === "reject"} disabled={!!busy} onPress={decline} style={{ flex: 1 }} />
        ) : null}
      </View>
      {!canDecline ? <P muted>This resident is a society admin. Only BorrowVault can decline them.</P> : null}
    </Card>
  );
}

/** The proof of residence, loaded on demand (presigned URL, 10 min). Images inline, PDFs in the browser. */
function Proof({ proofKey }: { proofKey: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!proofKey) {
    return <P muted>No proof uploaded. They used an invite code only: confirm the flat another way before approving.</P>;
  }
  const isPdf = proofKey.toLowerCase().endsWith(".pdf");

  async function load(): Promise<string | null> {
    setLoading(true);
    setError(null);
    try {
      const { url: u } = await getStorageUrl(proofKey!);
      setUrl(u);
      return u;
    } catch (e) {
      setError(friendlyError(e));
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function open() {
    const u = await load();
    if (u) await Linking.openURL(u).catch(() => setError("Couldn't open the document."));
  }

  if (isPdf) {
    return (
      <View style={{ gap: 4 }}>
        <Button title="Open proof (PDF)" icon="document-text-outline" variant="secondary" busy={loading} onPress={() => void open()} />
        <ErrorText>{error}</ErrorText>
      </View>
    );
  }
  return (
    <View style={{ gap: 4 }}>
      {url ? (
        <Pressable onPress={() => void Linking.openURL(url)} accessibilityLabel="Open proof full size">
          <Image
            source={{ uri: url }}
            resizeMode="contain"
            onError={() => {
              setUrl(null);
              setError("Couldn't load the proof. Tap View proof to try again.");
            }}
            style={{ width: "100%", height: 260, borderRadius: radius.md, backgroundColor: colors.border }}
          />
        </Pressable>
      ) : (
        <Button title="View proof" icon="image-outline" variant="secondary" busy={loading} onPress={() => void load()} />
      )}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}
