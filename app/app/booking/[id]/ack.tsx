// Counter-party acknowledgement of the other side's inspection (wireframe 6.2).
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ChecklistView } from "../../../src/components/Checklist";
import { GeofenceChip, SlotGrid, useEvidence } from "../../../src/components/Evidence";
import { MediaGrid } from "../../../src/components/MediaGrid";
import { Button, Card, Chip, ErrorText, Field, H2, Loading, P, Screen } from "../../../src/components/ui";
import { useAction, useLoader } from "../../../src/hooks/useAsync";
import { ackInspection, getBooking } from "../../../src/lib/api";
import { fenceFlag, myInspection, otherInspection } from "../../../src/lib/booking";
import { formatDateTime } from "../../../src/lib/format";
import { clearItems } from "../../../src/lib/uploadQueue";
import { colors } from "../../../src/lib/theme";
import type { InspectionPhase } from "../../../src/lib/types";

const OBJECTION_SLOT = "objection";

export default function AckScreen() {
  const { id, phase: rawPhase } = useLocalSearchParams<{ id: string; phase: string }>();
  const phase: InspectionPhase = rawPhase === "return" ? "return" : "handover";
  const router = useRouter();
  const { data: b, error, loading, reload } = useLoader(() => getBooking(id), [id]);
  const [objecting, setObjecting] = useState(false);
  const [note, setNote] = useState("");
  const ev = useEvidence(id, phase);
  const action = useAction();

  if (!b) {
    return (
      <Screen onRefresh={reload} refreshing={loading}>
        <Stack.Screen options={{ title: "Confirm" }} />
        {loading ? <Loading /> : <ErrorText>{error}</ErrorText>}
      </Screen>
    );
  }

  const theirs = otherInspection(b, phase);
  const mine = myInspection(b, phase);
  const whose = theirs?.party === "lender" ? "Lender" : "Borrower";
  const extra = ev.slots[OBJECTION_SLOT];
  const extraPending = !!extra && extra.status !== "verified" && extra.status !== "rejected";

  async function ack(result: "agreed" | "objected") {
    // Objection photos go in the ack's own `mediaIds` (slot `objection`, this phase).
    const mediaIds = result === "objected" ? ev.mediaIdsFor([OBJECTION_SLOT]) : [];
    const ok = await action.run(() =>
      ackInspection(b!.id, {
        phase,
        result,
        note: note.trim() || undefined,
        ...(mediaIds.length ? { mediaIds } : {}),
      }),
    );
    if (ok) {
      await clearItems(b!.id, phase, [OBJECTION_SLOT]);
      router.back();
    }
  }

  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <Stack.Screen options={{ title: phase === "handover" ? "Confirm handover" : "Confirm return" }} />
      {!theirs ? (
        <Card>
          <P>The other side hasn&apos;t submitted their {phase} inspection yet. Pull down to refresh.</P>
        </Card>
      ) : (
        <>
          <Card>
            <H2>
              {whose}&apos;s photos & checklist ({formatDateTime(theirs.submittedAt)})
            </H2>
            <Chip label={fenceFlag(theirs).label} tone={fenceFlag(theirs).ok ? "good" : "warn"} />
            <MediaGrid media={theirs.media} />
            {b.checklistSnapshot.length ? <ChecklistView items={b.checklistSnapshot} answers={theirs.checklistAnswers} /> : null}
          </Card>

          {mine ? (
            <Card>
              <H2>Your photos</H2>
              <MediaGrid media={mine.media} />
              {mine.ack ? (
                <>
                  <Chip
                    label={mine.ack.result === "agreed" ? "They confirmed yours ✓" : "They reported a difference"}
                    tone={mine.ack.result === "agreed" ? "good" : "bad"}
                  />
                  {mine.ack.note ? <P>“{mine.ack.note}”</P> : null}
                  {mine.ack.media.length ? <MediaGrid media={mine.ack.media} /> : null}
                </>
              ) : null}
            </Card>
          ) : null}

          {theirs.ack ? (
            <Card style={{ backgroundColor: theirs.ack.result === "agreed" ? colors.accentSoft : colors.dangerSoft }}>
              <H2>{theirs.ack.result === "agreed" ? "You confirmed it matches ✓" : "You reported a difference"}</H2>
              {theirs.ack.note ? <P>“{theirs.ack.note}”</P> : null}
              {theirs.ack.media.length ? <MediaGrid media={theirs.ack.media} /> : null}
              <P muted>{formatDateTime(theirs.ack.at)}</P>
            </Card>
          ) : (
            <Card>
              <H2>Does the item match the above?</H2>
              {!objecting ? (
                <View style={{ gap: 8 }}>
                  <Button
                    title={phase === "handover" ? "Yes, matches — start rental" : "Yes, matches"}
                    icon="checkmark-circle"
                    busy={action.busy}
                    onPress={() => void ack("agreed")}
                  />
                  <Button title="Something's different…" icon="alert-circle" variant="danger" onPress={() => setObjecting(true)} />
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  <Field label="What's different?" value={note} onChangeText={setNote} multiline placeholder="e.g. Charger missing, new scratch on the lens hood" />
                  <GeofenceChip ev={ev} fence={b.society} societyName={b.society.name} />
                  <SlotGrid ev={ev} slots={[OBJECTION_SLOT]} title="EXTRA PHOTO (optional, camera only)" />
                  <ErrorText>{action.error}</ErrorText>
                  <Button
                    title="Send to other side"
                    variant="danger"
                    busy={action.busy}
                    disabled={note.trim().length < 3 || extraPending}
                    onPress={() => void ack("objected")}
                  />
                  <Button title="Back" variant="ghost" onPress={() => setObjecting(false)} />
                  <P muted>They can amend their inspection or cancel the booking.</P>
                </View>
              )}
              {!objecting ? <ErrorText>{action.error}</ErrorText> : null}
            </Card>
          )}
          {phase === "handover" ? <P muted>Return by: {formatDateTime(b.endsAt)}</P> : null}
        </>
      )}
    </Screen>
  );
}
