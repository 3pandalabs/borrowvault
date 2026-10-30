// Lender's side-by-side return review (wireframe 6.3).
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { ChecklistDiff } from "../../../src/components/Checklist";
import { slotTitle, VIDEO_SLOT } from "../../../src/components/Evidence";
import { Button, Card, Chip, Countdown, ErrorText, Field, H2, Loading, P, Screen } from "../../../src/components/ui";
import { useAction, useLoader } from "../../../src/hooks/useAsync";
import { ackInspection, getBooking } from "../../../src/lib/api";
import { fenceFlag } from "../../../src/lib/booking";
import { formatDateTime } from "../../../src/lib/format";
import { colors, radius } from "../../../src/lib/theme";
import type { Inspection, Media } from "../../../src/lib/types";

const DAY = 24 * 3600_000;

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { data: b, error, loading, reload } = useLoader(() => getBooking(id), [id]);
  const [page, setPage] = useState(0);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");
  const action = useAction();

  if (!b) {
    return (
      <Screen onRefresh={reload} refreshing={loading}>
        <Stack.Screen options={{ title: "Review return" }} />
        {loading ? <Loading /> : <ErrorText>{error}</ErrorText>}
      </Screen>
    );
  }

  // Baseline = the lender's own handover record (fallback: borrower's).
  const handover: Inspection | undefined =
    b.inspections.find((i) => i.phase === "handover" && i.party === "lender") ?? b.inspections.find((i) => i.phase === "handover");
  const ret: Inspection | undefined =
    b.inspections.find((i) => i.phase === "return" && i.party === "borrower") ?? b.inspections.find((i) => i.phase === "return");

  const slots = b.photoSlotsSnapshot.length
    ? b.photoSlotsSnapshot
    : Array.from(new Set([...(handover?.media ?? []), ...(ret?.media ?? [])].map((m) => m.slot).filter((s) => s !== VIDEO_SLOT)));
  const pick = (insp: Inspection | undefined, slot: string) => insp?.media.find((m) => m.slot === slot);
  const onTime = ret ? new Date(ret.submittedAt) <= new Date(b.endsAt) : null;
  const deadline = b.deadlineAt ?? (ret ? new Date(new Date(ret.submittedAt).getTime() + DAY).toISOString() : null);
  const reviewed = !!ret?.ack;
  const pageW = width - 32 - 32; // screen padding + card padding

  async function allGood() {
    if (await action.run(() => ackInspection(b!.id, { phase: "return", result: "agreed" }))) router.back();
  }

  // Contract: "Report an issue" = ack objected with a note, then the raise-dispute screen.
  async function reportIssue() {
    const ok = await action.run(() => ackInspection(b!.id, { phase: "return", result: "objected", note: note.trim() }));
    if (ok) router.replace(`/booking/${b!.id}/dispute` as never);
  }

  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <Stack.Screen options={{ title: `Review return · ${b.listing.title}` }} />
      {ret ? (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <P>Returned {formatDateTime(ret.submittedAt)}</P>
          <Chip label={onTime ? "on time ✓" : "late ⚠"} tone={onTime ? "good" : "warn"} />
          {!fenceFlag(ret).ok ? <Chip label={fenceFlag(ret).label} tone="warn" /> : null}
        </View>
      ) : (
        <P muted>The borrower hasn&apos;t submitted the return yet.</P>
      )}

      {slots.length ? (
      <Card>
        <View style={{ flexDirection: "row" }}>
          <Text style={[st.colHead, { flex: 1 }]}>HANDOVER{handover ? ` (${formatDateTime(handover.submittedAt).split(",")[0]})` : ""}</Text>
          <Text style={[st.colHead, { flex: 1 }]}>RETURN{ret ? ` (${formatDateTime(ret.submittedAt).split(",")[0]})` : ""}</Text>
        </View>
        <FlatList
          data={slots}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(s) => s}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / pageW))}
          getItemLayout={(_, i) => ({ length: pageW, offset: pageW * i, index: i })}
          renderItem={({ item: slot }) => (
            <View style={{ width: pageW, gap: 6 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Side m={pick(handover, slot)} />
                <Side m={pick(ret, slot)} />
              </View>
              <Text style={st.slot}>{slotTitle(slot)}</Text>
            </View>
          )}
        />
        <View style={st.dots}>
          {slots.map((s, i) => (
            <View key={s} style={[st.dot, i === page && { backgroundColor: colors.accent }]} />
          ))}
        </View>
        <P muted>Swipe for the next photo.</P>
      </Card>
      ) : null}

      {b.checklistSnapshot.length && handover && ret ? (
        <Card>
          <H2>Checklist</H2>
          <ChecklistDiff items={b.checklistSnapshot} before={handover.checklistAnswers} after={ret.checklistAnswers} />
        </Card>
      ) : null}

      {ret && !reviewed && b.myRole === "lender" ? (
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <P muted>Auto-accepts in</P>
            <Countdown to={deadline} overdueText="Auto-accepting now" />
          </View>
          {!reporting ? (
            <>
              <ErrorText>{action.error}</ErrorText>
              <Button title="All good — release deposit" icon="checkmark-circle" busy={action.busy} onPress={allGood} />
              <Button title="Report an issue" icon="flag" variant="danger" onPress={() => setReporting(true)} />
            </>
          ) : (
            <>
              <Field label="What's wrong?" value={note} onChangeText={setNote} multiline placeholder="e.g. 1 drill bit missing, new crack on the case" />
              <ErrorText>{action.error}</ErrorText>
              <Button title="Object & raise dispute" icon="flag" variant="danger" busy={action.busy} disabled={note.trim().length < 3} onPress={reportIssue} />
              <Button title="Back" variant="ghost" onPress={() => setReporting(false)} />
              <P muted>Next you&apos;ll set the claim and add photos. You have the same 24 h window.</P>
            </>
          )}
        </Card>
      ) : reviewed ? (
        <Card>
          <P>Return reviewed: {ret!.ack!.result}{ret!.ack!.note ? ` · “${ret!.ack!.note}”` : ""}</P>
          {ret!.ack!.result === "objected" && !b.dispute && b.myRole === "lender" ? (
            <Button title="Raise dispute" icon="flag" variant="danger" onPress={() => router.push(`/booking/${b.id}/dispute` as never)} />
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

function Side({ m }: { m: Media | undefined }) {
  const [zoom, setZoom] = useState(false);
  if (!m) {
    return (
      <View style={[st.img, { alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ color: colors.fgMuted, fontSize: 12 }}>No photo</Text>
      </View>
    );
  }
  return (
    <Pressable style={{ flex: 1 }} onPress={() => setZoom((z) => !z)}>
      <Image source={{ uri: m.url }} style={[st.img, zoom && { aspectRatio: 0.75 }]} resizeMode={zoom ? "contain" : "cover"} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  colHead: { fontSize: 11, fontWeight: "800", color: colors.fgMuted, letterSpacing: 0.4 },
  img: { flex: 1, aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.bgSubtle },
  slot: { textAlign: "center", fontWeight: "700", color: colors.fg },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
});
