import { Stack } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, Chip, Empty, ErrorText, KV, Loading, P, Screen } from "../src/components/ui";
import { useLoader } from "../src/hooks/useAsync";
import { useAuth } from "../src/hooks/useAuth";
import { adminRequestError, listMyAdminRequests, withdrawAdminRequest } from "../src/lib/api";
import { formatDateTime } from "../src/lib/format";
import { colors } from "../src/lib/theme";
import type { AdminRequest, AdminRequestStatus } from "../src/lib/types";

const STATUS: Record<AdminRequestStatus, { label: string; tone?: "good" | "warn" | "bad" }> = {
  pending: { label: "Under review", tone: "warn" },
  approved: { label: "Approved", tone: "good" },
  rejected: { label: "Not approved", tone: "bad" },
  withdrawn: { label: "Withdrawn" },
};

export default function MyAdminRequests() {
  const { refresh } = useAuth();
  const list = useLoader(listMyAdminRequests);

  return (
    <Screen refreshing={list.loading && !!list.data} onRefresh={() => {
        void list.reload();
        void refresh(); // an approval changes my membership role
      }}>
      <Stack.Screen options={{ title: "My admin requests" }} />
      <P muted>
        The BorrowVault team checks every admin request against its documents. Approval usually takes a couple of
        working days, and we email you either way.
      </P>
      <ErrorText>{list.error}</ErrorText>
      {!list.data && list.loading ? <Loading /> : null}
      {list.data?.length === 0 ? (
        <Empty title="No admin requests" body="Requests you send from the BorrowVault website show up here." />
      ) : null}
      {list.data?.map((r) => (
        <RequestCard
          key={r.id}
          r={r}
          onChanged={(next) => {
            list.setData((cur) => cur?.map((x) => (x.id === next.id ? next : x)) ?? cur);
          }}
        />
      ))}
    </Screen>
  );
}

function RequestCard({
  r,
  onChanged,
}: {
  r: AdminRequest;
  onChanged: (r: AdminRequest) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = STATUS[r.status];

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      onChanged(await withdrawAdminRequest(r.id));
    } catch (e) {
      setError(adminRequestError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Text style={{ fontWeight: "700", color: colors.fg, flex: 1 }}>{r.societyName}</Text>
        <Chip label={s.label} tone={s.tone} />
      </View>
      <P muted>
        {r.kind === "new_society" ? "Register a new society" : "Become an admin"} · {r.committeeRole}
      </P>
      {r.proposedSociety ? (
        <KV k="Your flat" v={`${r.proposedSociety.towerName}-${r.proposedSociety.flatNo}, ${r.proposedSociety.city}`} />
      ) : null}
      <KV k="Sent" v={formatDateTime(r.createdAt)} />
      {r.reviewedAt ? <KV k="Reviewed" v={formatDateTime(r.reviewedAt)} /> : null}
      {r.reviewNote ? (
        <View
          style={{
            backgroundColor: r.status === "rejected" ? colors.dangerSoft : colors.bgSubtle,
            borderRadius: 8,
            padding: 10,
            gap: 2,
          }}
        >
          <Text style={{ fontWeight: "700", color: colors.fg }}>Note from BorrowVault</Text>
          <P>{r.reviewNote}</P>
        </View>
      ) : null}
      {r.status === "rejected" ? (
        <P muted>You can send a new request with clearer documents from the website.</P>
      ) : null}
      {r.status === "approved" ? (
        <P muted>You&apos;re now a society admin. Manage your society from the BorrowVault website.</P>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {r.status === "pending" ? (
        <Button title="Withdraw request" variant="danger" onPress={() => void withdraw()} busy={busy} />
      ) : null}
    </Card>
  );
}
