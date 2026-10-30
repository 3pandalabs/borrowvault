// Handover / return inspection capture (blueprint wireframes 6.1 / 6.2).
// Camera only: there is no gallery path on this screen.
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { ChecklistForm } from "../../../src/components/Checklist";
import { GeofenceChip, SlotGrid, useEvidence, VIDEO_SLOT } from "../../../src/components/Evidence";
import { Button, Card, Chip, ErrorText, H2, KV, Loading, P, Screen, TrustBadge } from "../../../src/components/ui";
import { useAction, useLoader } from "../../../src/hooks/useAsync";
import { getBooking, submitInspection } from "../../../src/lib/api";
import { counterParty, fenceFlag, myInspection } from "../../../src/lib/booking";
import { allAnswered, isAnswered } from "../../../src/lib/checklist";
import { formatDateTime, formatPaise } from "../../../src/lib/format";
import { clearItems } from "../../../src/lib/uploadQueue";
import { colors } from "../../../src/lib/theme";
import type { ChecklistAnswer, Geo, InspectionPhase } from "../../../src/lib/types";

export default function InspectScreen() {
  const { id, phase: rawPhase } = useLocalSearchParams<{ id: string; phase: string }>();
  const phase: InspectionPhase = rawPhase === "return" ? "return" : "handover";
  const router = useRouter();
  const { data: b, error, loading, reload } = useLoader(() => getBooking(id), [id]);
  const ev = useEvidence(id, phase);
  const [answers, setAnswers] = useState<Record<string, ChecklistAnswer>>({});
  const submit = useAction();

  const title = phase === "handover" ? "Handover" : "Return";
  if (!b) {
    return (
      <Screen onRefresh={reload} refreshing={loading}>
        <Stack.Screen options={{ title }} />
        {loading ? <Loading /> : <ErrorText>{error}</ErrorText>}
      </Screen>
    );
  }

  // Skills skip handover; their "return" is "delivered" with no media/checklist.
  const isSkill = b.listing.kind === "skill";
  const slots = isSkill ? [] : b.photoSlotsSnapshot;
  const checklist = isSkill ? [] : b.checklistSnapshot;
  const already = myInspection(b, phase);
  const other = counterParty(b);
  const slotsDone = slots.every((s) => ev.verified(s));
  const answered = allAnswered(checklist, answers);
  const videoItem = ev.slots[VIDEO_SLOT];
  const videoPending = !!videoItem && videoItem.status !== "verified" && videoItem.status !== "rejected";
  const canSubmit = slotsDone && answered && !videoPending && !already;

  const missing: string[] = [];
  if (!slotsDone) missing.push(`${slots.filter((s) => !ev.verified(s)).length} photo(s) not yet verified`);
  if (!answered) missing.push(`${checklist.filter((c) => !isAnswered(c, answers[c.id])).length} checklist item(s) unanswered`);
  if (videoPending) missing.push("video still uploading");

  async function onSubmit() {
    const latest = ev.loc.latest;
    const geo: Geo | null = latest
      ? {
          lat: latest.coords.latitude,
          lng: latest.coords.longitude,
          accuracyM: Math.round(latest.coords.accuracy ?? 9999),
          capturedAt: new Date().toISOString(),
        }
      : null;
    const mediaIds = ev.mediaIdsFor(videoItem?.status === "verified" ? [...slots, VIDEO_SLOT] : slots);
    const ok = await submit.run(() => submitInspection(b!.id, { phase, mediaIds, checklistAnswers: answers, geo }));
    if (ok) {
      await clearItems(b!.id, phase);
      router.back();
    }
  }

  return (
    <Screen
      onRefresh={reload}
      refreshing={loading}
      footer={
        already ? null : (
          <>
            {!canSubmit && missing.length ? <Text style={{ color: colors.fgMuted, fontSize: 12, textAlign: "center" }}>{missing.join(" · ")}</Text> : null}
            <ErrorText>{submit.error}</ErrorText>
            <Button
              title={isSkill ? "Mark as delivered" : `Submit & show to ${b.myRole === "lender" ? "borrower" : "lender"}`}
              onPress={onSubmit}
              busy={submit.busy}
              disabled={!canSubmit}
            />
          </>
        )
      }
    >
      <Stack.Screen options={{ title: `${isSkill ? (phase === "return" ? "Delivered" : "Start") : title} · ${b.listing.title}` }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <P muted>
          {b.myRole === "lender" ? "Borrower" : "Lender"}: {other.displayName} · {other.towerName}-{other.flatNo}
        </P>
        <TrustBadge trust={other.trust} />
      </View>
      <GeofenceChip ev={ev} fence={b.society} societyName={b.society.name} />

      {already ? (
        <Card style={{ backgroundColor: colors.accentSoft }}>
          <H2>Submitted ✓</H2>
          <P>
            You submitted your {phase} inspection on {formatDateTime(already.submittedAt)}.
            {fenceFlag(already).ok ? "" : ` Flagged: ${fenceFlag(already).label.replace("📍 ", "")}.`}
          </P>
          {already.ack ? <Chip label={`Other side: ${already.ack.result}`} tone={already.ack.result === "agreed" ? "good" : "bad"} /> : <P muted>Waiting for the other side to check it.</P>}
          <Button title="Back to booking" variant="secondary" onPress={() => router.back()} />
        </Card>
      ) : (
        <>
          <Card>
            {isSkill ? (
              <P>Skills have no handover photos. Confirm the job is done; the other side then has 24 hours to agree or raise an issue.</P>
            ) : slots.length ? (
              <SlotGrid ev={ev} slots={slots} allowVideo />
            ) : (
              <P muted>No photos are required for this booking.</P>
            )}
            <P muted>
              Each photo is stamped with your location and a fingerprint (SHA-256) before upload, so neither side can swap it
              later. Uploads keep retrying if the network drops.
            </P>
          </Card>

          {checklist.length ? (
            <Card>
              <H2>Checklist</H2>
              <ChecklistForm items={checklist} answers={answers} onChange={setAnswers} />
            </Card>
          ) : null}

          <Card>
            {b.depositPaise > 0 ? <KV k={b.payment?.depositMode === "p2p" ? "Deposit paid" : "Deposit (declared)"} v={formatPaise(b.depositPaise)} /> : null}
            <KV k="Fee" v={formatPaise(b.feePaise)} />
            <KV k="Return by" v={formatDateTime(b.endsAt)} />
          </Card>
        </>
      )}
    </Screen>
  );
}
