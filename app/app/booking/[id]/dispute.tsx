// Raise / respond / accept offer / view ruling (wireframe 6.4, resident side).
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { GeofenceChip, SlotGrid, useEvidence } from "../../../src/components/Evidence";
import { Button, Card, Chip, Countdown, ErrorText, Field, H2, KV, Label, Loading, P, Screen } from "../../../src/components/ui";
import { useAction, useLoader } from "../../../src/hooks/useAsync";
import { useAuth } from "../../../src/hooks/useAuth";
import { acceptDisputeOffer, getBooking, raiseDispute, respondDispute } from "../../../src/lib/api";
import { formatDateTime, formatPaise, rupeesToPaise } from "../../../src/lib/format";
import { DISPUTE_CATEGORIES, disputeCategoryLabel } from "../../../src/lib/labels";
import { clearItems } from "../../../src/lib/uploadQueue";
import { colors } from "../../../src/lib/theme";
import { MediaGrid } from "../../../src/components/MediaGrid";
import type { BookingDetail, DisputeCategory } from "../../../src/lib/types";

const RAISABLE = new Set(["HANDOVER_PENDING", "ACTIVE", "OVERDUE", "RETURN_PENDING"]);
const DESC_MIN = 10;
const DESC_MAX = 2000;

export default function DisputeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: b, setData, error, loading, reload } = useLoader(() => getBooking(id), [id]);

  if (!b) {
    return (
      <Screen onRefresh={reload} refreshing={loading}>
        <Stack.Screen options={{ title: "Dispute" }} />
        {loading ? <Loading /> : <ErrorText>{error}</ErrorText>}
      </Screen>
    );
  }
  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <Stack.Screen options={{ title: b.dispute ? "Dispute" : "Report an issue" }} />
      {b.dispute ? <DisputeView b={b} onUpdate={setData} /> : RAISABLE.has(b.state) ? <RaiseForm b={b} /> : <P muted>A dispute can&apos;t be raised at this stage.</P>}
    </Screen>
  );
}

function RaiseForm({ b }: { b: BookingDetail }) {
  const router = useRouter();
  const ev = useEvidence(b.id, "dispute");
  const [category, setCategory] = useState<DisputeCategory>(b.myRole === "lender" ? "damage" : "not_as_described");
  const [claim, setClaim] = useState("");
  const [description, setDescription] = useState("");
  const [extraCount, setExtraCount] = useState(1);
  const action = useAction();
  const slots = Array.from({ length: extraCount }, (_, i) => `dispute-${i + 1}`);
  const claimPaise = claim ? rupeesToPaise(claim) : 0;
  // ROUTES.md cap: max(deposit, replacement value); a borrower may alternatively claim up to fee + deposit.
  const itemCap = Math.max(b.depositPaise, b.replacementValuePaise ?? 0);
  const max = b.myRole === "borrower" ? Math.max(itemCap, b.feePaise + b.depositPaise) : itemCap;
  const claimError =
    claimPaise === null ? "Enter rupees, e.g. 250" : claimPaise > max ? `Claim can't be more than ${formatPaise(max)}` : null;
  const uploading = slots.some((s) => ev.slots[s] && ev.slots[s].status !== "verified" && ev.slots[s].status !== "rejected");
  const valid = !claimError && description.trim().length >= DESC_MIN && description.trim().length <= DESC_MAX && !uploading;

  async function submit() {
    const ok = await action.run(() =>
      raiseDispute(b.id, { category, description: description.trim(), claimedPaise: claimPaise ?? 0, mediaIds: ev.mediaIdsFor(slots) }),
    );
    if (ok) {
      await clearItems(b.id, "dispute");
      router.back();
    }
  }

  return (
    <>
      <Card>
        <Label>Category</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {DISPUTE_CATEGORIES.map((c) => (
            <Chip key={c.key} label={c.label} selected={category === c.key} onPress={() => setCategory(c.key)} />
          ))}
        </View>
        <Field
          label={`Claim (₹, max ${formatPaise(max)})`}
          value={claim}
          onChangeText={setClaim}
          keyboardType="decimal-pad"
          error={claim ? claimError : null}
          hint={b.myRole === "borrower" ? "Up to the fee plus deposit, or the item's deposit/replacement value." : "Up to the deposit or the item's replacement value. Anything above the deposit you hold is recorded as a debt."}
        />
        <Field label="Describe what happened" value={description} onChangeText={setDescription} multiline maxLength={DESC_MAX} placeholder="e.g. 1 drill bit missing from the case" hint={`At least ${DESC_MIN} characters`} />
      </Card>
      <Card>
        <GeofenceChip ev={ev} fence={b.society} societyName={b.society.name} />
        <SlotGrid ev={ev} slots={slots} title="EXTRA PHOTOS (camera only)" />
        {extraCount < 4 && slots.every((s) => ev.slots[s]) ? (
          <Button title="Add another photo" variant="ghost" icon="add" onPress={() => setExtraCount((n) => n + 1)} />
        ) : null}
      </Card>
      <P muted>
        A society admin who isn&apos;t either of you (and doesn&apos;t live in your flats) decides if you can&apos;t agree within 72 hours.
      </P>
      <ErrorText>{action.error}</ErrorText>
      <Button title="Submit dispute" variant="danger" busy={action.busy} disabled={!valid} onPress={submit} />
    </>
  );
}

function DisputeView({ b, onUpdate }: { b: BookingDetail; onUpdate: (d: BookingDetail) => void }) {
  const { user } = useAuth();
  const d = b.dispute!;
  const [response, setResponse] = useState("");
  const [offer, setOffer] = useState("");
  const action = useAction();

  // raisedBy is a user id, or "system" for the auto refund dispute raised on the borrower's behalf.
  const raisedByMe = d.raisedBy === user?.id || (d.raisedBySystem && b.myRole === "borrower");
  const resolved = d.status === "resolved" || d.status === "withdrawn" || b.state === "RESOLVED";
  const offerPaise = offer ? rupeesToPaise(offer) : undefined;
  const offerError = offerPaise === null ? "Enter rupees" : offerPaise !== undefined && offerPaise > d.claimedPaise ? "Offer can't exceed the claim" : null;

  const run = async (fn: () => Promise<BookingDetail>) => {
    await action.run(async () => onUpdate(await fn()));
  };

  return (
    <>
      <Card>
        <H2 right={!resolved ? <Countdown to={d.deadlineAt} prefix="ruling in" overdueText="Escalated" /> : null}>
          {disputeCategoryLabel(d.category)}
        </H2>
        <P>{d.description}</P>
        <KV k="Raised by" v={d.raisedBy === "system" ? "BorrowVault (automatic)" : raisedByMe ? "You" : b.myRole === "lender" ? b.borrower.displayName : b.lender.displayName} />
        <KV k="Claimed" v={formatPaise(d.claimedPaise)} />
        {d.escalatedAt ? <Chip label="Escalated to BorrowVault" tone="warn" /> : null}
        {d.media?.length ? <MediaGrid media={d.media} /> : null}
        <KV k="Status" v={d.status.replace(/_/g, " ")} />
      </Card>

      {d.responseText || d.offerPaise !== null ? (
        <Card>
          <H2>Response</H2>
          {d.responseText ? <P>“{d.responseText}”</P> : null}
          {d.offerPaise !== null ? <KV k="Offer" v={formatPaise(d.offerPaise)} /> : null}
        </Card>
      ) : null}

      {!resolved && !raisedByMe && !d.responseText ? (
        <Card>
          <H2>Your response</H2>
          <Field label="Your side" value={response} onChangeText={setResponse} multiline />
          <Field
            label="Offer to settle (₹, optional)"
            value={offer}
            onChangeText={setOffer}
            keyboardType="decimal-pad"
            error={offerError}
            hint={`They claimed ${formatPaise(d.claimedPaise)}. If they accept your offer, it settles straight away.`}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title={`Accept ${formatPaise(d.claimedPaise)}`} variant="secondary" style={{ flex: 1 }} onPress={() => { setOffer(String(d.claimedPaise / 100)); if (!response) setResponse("I accept the claim."); }} />
          </View>
          <ErrorText>{action.error}</ErrorText>
          <Button
            title="Send response"
            busy={action.busy}
            disabled={response.trim().length < 3 || !!offerError}
            onPress={() => void run(() => respondDispute(b.id, { responseText: response.trim(), ...(typeof offerPaise === "number" ? { offerPaise } : {}) }))}
          />
        </Card>
      ) : null}

      {!resolved && raisedByMe && d.offerPaise !== null ? (
        <Card>
          <P>They offered {formatPaise(d.offerPaise)} to settle.</P>
          <ErrorText>{action.error}</ErrorText>
          <Button title={`Accept ${formatPaise(d.offerPaise)}`} busy={action.busy} onPress={() => void run(() => acceptDisputeOffer(b.id))} />
          <P muted>Or wait for the society admin&apos;s ruling.</P>
        </Card>
      ) : null}

      {resolved ? (
        <Card style={{ backgroundColor: colors.accentSoft }}>
          <H2>Resolved</H2>
          <KV k="Award" v={formatPaise(d.awardPaise ?? 0)} />
          {d.rulingNote ? <P>“{d.rulingNote}”</P> : null}
          {d.resolvedAt ? <P muted>{formatDateTime(d.resolvedAt)}</P> : null}
          {b.payment && (b.payment.awardFromDepositPaise ?? 0) > 0 ? (
            <KV k="Kept from deposit" v={formatPaise(b.payment.awardFromDepositPaise)} />
          ) : null}
          {b.payment?.awardStatus === "debt_recorded" || b.payment?.awardStatus === "paid_claimed" ? (
            <P muted>The rest is recorded as a debt, paid by UPI from the booking screen.</P>
          ) : b.payment?.awardStatus === "paid" ? (
            <P muted>Award paid ✓</P>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
