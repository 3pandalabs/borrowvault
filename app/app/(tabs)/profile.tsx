import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { Button, Card, Chip, ErrorText, Field, H2, KV, P, Screen, TrustBadge } from "../../src/components/ui";
import { useAction, useLoader } from "../../src/hooks/useAsync";
import { useAuth } from "../../src/hooks/useAuth";
import { listListings, listMyAdminRequests, updateListing, updateMe } from "../../src/lib/api";
import { formatDate } from "../../src/lib/format";
import { priceLine } from "../../src/lib/labels";
import { openWeb } from "../../src/lib/openWeb";
import { colors } from "../../src/lib/theme";
import type { AdminRequest, ListingSummary, Membership, User } from "../../src/lib/types";
import { isValidVpa, normalisePhone } from "../../src/lib/validation";
import { adminRequestUrl, societyAdminsUrl } from "../../src/lib/web";

export default function Profile() {
  const router = useRouter();
  const { user, memberships, approved, signOut, refresh } = useAuth();
  const save = useAction();

  const mine = useLoader(() => listListings({ ownerId: "me" }), [user?.id, approved.length]);
  const adminRequests = useLoader(listMyAdminRequests, [user?.id]);

  async function setStatus(l: ListingSummary, status: "active" | "paused" | "archived") {
    await save.run(() => updateListing(l.id, { status }));
    void mine.reload();
  }

  if (!user) return null;

  return (
    <Screen onRefresh={() => void refresh()}>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <H2>{user.displayName}</H2>
          <TrustBadge trust={user.trust} />
        </View>
        <P muted>{user.email}</P>
        <P muted>
          {user.trust.completed} completed in your society
          {user.trust.disputesLost ? ` · ${user.trust.disputesLost} disputes lost` : ""}
        </P>
      </Card>

      {/* Keyed on the saved values so a server refresh resets the form without an effect. */}
      <DetailsForm key={`${user.displayName}|${user.phone}|${user.upiVpa}`} user={user} />

      <NotificationsCard user={user} />

      <Card>
        <H2 right={<Button title="Join another" variant="ghost" onPress={() => router.push("/onboarding")} />}>My societies</H2>
        {memberships.map((m) => (
          <View key={m.id} style={{ paddingVertical: 6, gap: 2 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontWeight: "700", color: colors.fg, flex: 1 }}>{m.societyName}</Text>
              <Chip
                label={m.status}
                tone={m.status === "approved" ? "good" : m.status === "pending" ? "warn" : "bad"}
              />
            </View>
            <P muted>
              {m.towerName}-{m.flatNo} · {m.occupancy}
              {m.role === "society_admin" ? " · Society admin" : ""}
              {m.societyTier === "pilot" ? " · Pilot society" : ""} · since {formatDate(m.createdAt)}
            </P>
          </View>
        ))}
      </Card>

      <SocietyAdminCard
        memberships={approved}
        requests={adminRequests.data ?? []}
        onOpenRequests={() => router.push("/admin-requests")}
      />

      <Card>
        <H2 right={<Button title="New" variant="ghost" icon="add" onPress={() => router.push("/listing/new")} />}>My listings</H2>
        {mine.data?.length === 0 ? <P muted>You haven&apos;t listed anything yet.</P> : null}
        {mine.data?.map((l) => (
          <View key={l.id} style={{ paddingVertical: 8, gap: 4, borderTopWidth: 1, borderColor: colors.border }}>
            <Pressable onPress={() => router.push(`/listing/${l.id}`)}>
              <Text style={{ fontWeight: "700", color: colors.fg }}>{l.title}</Text>
              <P muted>{priceLine(l)}</P>
            </Pressable>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <KV k="Status" v={l.status} />
              {l.status === "active" ? <Chip label="Pause" onPress={() => void setStatus(l, "paused")} /> : null}
              {l.status === "paused" ? <Chip label="Resume" onPress={() => void setStatus(l, "active")} /> : null}
              {l.status !== "archived" ? <Chip label="Archive" onPress={() => void setStatus(l, "archived")} /> : null}
            </View>
          </View>
        ))}
        <ErrorText>{save.error}</ErrorText>
      </Card>

      <Button title="Sign out" variant="danger" onPress={() => void signOut()} />
      <Text style={{ textAlign: "center", color: colors.fgMuted, fontSize: 12 }}>BorrowVault | by 3PandaLabs</Text>
    </Screen>
  );
}

/**
 * Becoming a society admin needs documents the platform verifies, so the
 * request itself is made on the web; the app explains it and tracks status.
 */
function SocietyAdminCard({
  memberships,
  requests,
  onOpenRequests,
}: {
  memberships: Membership[];
  requests: AdminRequest[];
  onOpenRequests: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const eligible = memberships.filter((m) => m.status === "approved" && m.role !== "society_admin");
  if (eligible.length === 0 && requests.length === 0) return null;

  const pendingFor = (societyId: string) =>
    requests.some((r) => r.kind === "join_admin" && r.status === "pending" && r.societyId === societyId);

  async function apply(societyId: string) {
    setError(await openWeb(adminRequestUrl(societyId)));
  }

  return (
    <Card>
      <H2
        right={
          requests.length > 0 ? <Button title="My requests" variant="ghost" onPress={onOpenRequests} /> : undefined
        }
      >
        Society admin
      </H2>
      {eligible.length > 0 ? (
        <>
          <P muted>
            Admins approve residents and settle disputes for their society. To become one, upload your own ID proof on
            the BorrowVault website (a masked Aadhaar, PAN, passport or driving licence). An admin can also nominate
            you. The BorrowVault team checks every admin.
          </P>
          {eligible.map((m) =>
            pendingFor(m.societyId) ? (
              <View key={m.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ color: colors.fg, flex: 1 }}>{m.societyName}</Text>
                <Chip label="Under review" tone="warn" onPress={onOpenRequests} />
              </View>
            ) : (
              <Button
                key={m.id}
                title={eligible.length > 1 ? `Become an admin of ${m.societyName}` : "Become a society admin"}
                icon="open-outline"
                variant="secondary"
                onPress={() => void apply(m.societyId)}
              />
            ),
          )}
          <ErrorText>{error}</ErrorText>
        </>
      ) : (
        <P muted>Track your admin requests and co-admin nominations.</P>
      )}
      {memberships
        .filter((m) => m.status === "approved" && m.role === "society_admin")
        .map((m) => (
          <Button
            key={m.id}
            title={`Nominate a co-admin for ${m.societyName}`}
            icon="open-outline"
            variant="ghost"
            onPress={() => void openWeb(societyAdminsUrl(m.societyId)).then(setError)}
          />
        ))}
    </Card>
  );
}

/** PATCH /me {chatPushEnabled}: chat push on/off for all of this user's devices. */
function NotificationsCard({ user }: { user: User }) {
  const { setUser } = useAuth();
  const save = useAction();

  async function toggle(next: boolean) {
    await save.run(async () => {
      const res = await updateMe({ chatPushEnabled: next });
      setUser(res.user);
    });
  }

  return (
    <Card>
      <H2>Notifications</H2>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700", color: colors.fg }}>Chat notifications</Text>
          <P muted>A notification when a neighbour messages you about a listing or booking.</P>
        </View>
        <Switch
          value={user.chatPushEnabled}
          onValueChange={(v) => void toggle(v)}
          disabled={save.busy}
          trackColor={{ true: colors.accent }}
          accessibilityLabel="Chat notifications"
        />
      </View>
      <ErrorText>{save.error}</ErrorText>
    </Card>
  );
}

function DetailsForm({ user }: { user: User }) {
  const { setUser } = useAuth();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [phone, setPhone] = useState(user.phone);
  const [upiVpa, setUpiVpa] = useState(user.upiVpa ?? "");
  const [saved, setSaved] = useState(false);
  const save = useAction();

  const vpaError = upiVpa.trim() && !isValidVpa(upiVpa) ? "Looks like name@bank, e.g. priya.s@okicici" : null;
  const phoneN = normalisePhone(phone);
  const phoneError = phone && !phoneN ? "Enter a 10-digit Indian mobile number" : null;
  const dirty =
    displayName.trim() !== user.displayName ||
    (phoneN ?? phone) !== user.phone ||
    upiVpa.trim() !== (user.upiVpa ?? "");

  async function onSave() {
    setSaved(false);
    const ok = await save.run(async () => {
      const res = await updateMe({
        displayName: displayName.trim(),
        phone: phoneN ?? undefined,
        upiVpa: upiVpa.trim() || undefined,
      });
      setUser(res.user);
    });
    if (ok) setSaved(true);
  }

  return (
    <Card>
      <H2>Your details</H2>
      <Field label="Name" value={displayName} onChangeText={setDisplayName} />
      <Field label="Mobile" value={phone} onChangeText={setPhone} keyboardType="phone-pad" error={phoneError} />
      <Field
        label="UPI ID (VPA)"
        value={upiVpa}
        onChangeText={(t) => setUpiVpa(t.replace(/\s/g, ""))}
        autoCapitalize="none"
        placeholder="yourname@okhdfcbank"
        error={vpaError}
        hint="Needed to lend: borrowers pay you directly via UPI. BorrowVault never holds money."
      />
      <ErrorText>{save.error}</ErrorText>
      {saved && !dirty ? <P style={{ color: colors.accent }}>Saved ✓</P> : null}
      <Button title="Save" onPress={onSave} busy={save.busy} disabled={!dirty || !!vpaError || !!phoneError || displayName.trim().length < 2} />
    </Card>
  );
}
