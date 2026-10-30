import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Button, Card, Chip, Countdown, ErrorText, Field, H2, KV, Loading, P, Screen, StateBadge, TrustBadge } from "../../../src/components/ui";
import { useAction, useLoader } from "../../../src/hooks/useAsync";
import {
  acceptBooking,
  awardPaidClaim,
  awardPaidConfirm,
  cancelBooking,
  claimPayment,
  confirmPayment,
  declineBooking,
  depositRefundClaim,
  depositRefundConfirm,
  getBooking,
} from "../../../src/lib/api";
import { counterParty, fenceFlag, myInspection, openUpi, otherInspection, PRE_ACTIVE, upiPayee } from "../../../src/lib/booking";
import { formatDateTime, formatPaise, formatStateLabel } from "../../../src/lib/format";
import { disputeCategoryLabel, isWaiting, nextActionLabel } from "../../../src/lib/labels";
import { colors } from "../../../src/lib/theme";
import type { BookingDetail } from "../../../src/lib/types";
import { isValidUtr } from "../../../src/lib/validation";

export default function BookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: b, setData, error, loading, reload } = useLoader(() => getBooking(id), [id]);

  if (!b) {
    return (
      <Screen onRefresh={reload} refreshing={loading}>
        <Stack.Screen options={{ title: "Booking" }} />
        {loading ? <Loading /> : <ErrorText>{error}</ErrorText>}
      </Screen>
    );
  }

  const other = counterParty(b);
  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <Stack.Screen options={{ title: b.listing.title }} />
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <H2>{b.listing.title}</H2>
          <StateBadge state={b.state} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <P muted>
            {b.myRole === "lender" ? "Borrower" : "Lender"}: {other.displayName} · {other.towerName}-{other.flatNo}
          </P>
          <TrustBadge trust={other.trust} />
        </View>
        <KV k="From" v={formatDateTime(b.startsAt)} />
        <KV k="Return by" v={formatDateTime(b.endsAt)} />
        <KV k="Fee" v={formatPaise(b.feePaise)} />
        {b.depositPaise > 0 ? (
          <KV k={b.payment?.depositMode === "p2p" ? "Deposit (paid to lender)" : "Deposit (declared)"} v={formatPaise(b.depositPaise)} />
        ) : null}
      </Card>

      <NextActionCard b={b} onUpdate={setData} />
      <EvidenceLinks b={b} />

      {b.dispute ? (
        <DisputeSummary b={b} />
      ) : ["ACTIVE", "OVERDUE"].includes(b.state) && b.myRole !== "admin" ? (
        <ReportIssueLink id={b.id} />
      ) : null}

      {PRE_ACTIVE.has(b.state) && b.myRole !== "admin" ? <CancelButton b={b} onUpdate={setData} /> : null}

      {b.events.length ? (
        <Card>
          <H2>Timeline</H2>
          {b.events.map((e, i) => (
            <View key={`${e.at}-${i}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ color: colors.fg, flex: 1 }}>
                {formatStateLabel(e.toState)}
                {e.reason ? <Text style={{ color: colors.fgMuted }}> · {e.reason.replace(/_/g, " ")}</Text> : null}
              </Text>
              <Text style={{ color: colors.fgMuted, fontSize: 12 }}>{formatDateTime(e.at)}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function NextActionCard({ b, onUpdate }: { b: BookingDetail; onUpdate: (d: BookingDetail) => void }) {
  const router = useRouter();
  const action = useAction();
  const [utr, setUtr] = useState("");
  const [upiError, setUpiError] = useState<string | null>(null);
  const label = nextActionLabel(b);
  if (!label) return null;

  const go = (path: string) => router.push(path as never);
  const run = async (fn: () => Promise<BookingDetail>) => {
    await action.run(async () => onUpdate(await fn()));
  };
  const pay = async (url: string | null | undefined) => {
    setUpiError(url ? await openUpi(url) : "Payment link not available yet. Pull down to refresh.");
  };
  const p = b.payment;
  const refundDue = p?.refundDuePaise ?? b.depositPaise;
  // Award debts run payer → payee (payer = whoever did NOT raise the dispute), minus anything kept from a p2p deposit.
  const awardDue = Math.max(0, (p?.awardPaise ?? b.dispute?.awardPaise ?? 0) - (p?.awardFromDepositPaise ?? 0));
  const partyById = (uid: string | null | undefined) => [b.lender, b.borrower].find((x) => x.id === uid);
  const awardPayer = partyById(p?.awardPayerId);
  const awardPayee = partyById(p?.awardPayeeId);

  let body: React.ReactNode = null;
  switch (b.nextAction) {
    case "accept_or_decline":
      body = (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="Accept" style={{ flex: 1 }} busy={action.busy} onPress={() => void run(() => acceptBooking(b.id))} />
          <Button title="Decline" variant="danger" style={{ flex: 1 }} disabled={action.busy} onPress={() => void run(() => declineBooking(b.id))} />
        </View>
      );
      break;
    case "pay":
      body = (
        <>
          <P muted>
            Pay {upiPayee(p?.feeUpiIntent) ?? "the lender"} directly with any UPI app. BorrowVault never holds your money.
          </P>
          <Button title={`Pay fee ${formatPaise(b.feePaise)} via UPI`} icon="wallet" onPress={() => void pay(p?.feeUpiIntent)} />
          {p?.depositUpiIntent ? (
            <Button title={`Pay deposit ${formatPaise(b.depositPaise)} via UPI`} variant="secondary" icon="shield-checkmark" onPress={() => void pay(p.depositUpiIntent)} />
          ) : null}
          <Field
            label="UPI reference / UTR (optional)"
            value={utr}
            onChangeText={(t) => setUtr(t.replace(/\s/g, ""))}
            autoCapitalize="characters"
            hint="12-digit number from your UPI app's receipt. Helps the lender find it."
            error={utr && !isValidUtr(utr) ? "Usually 12 digits" : null}
          />
          <Button
            title="I've paid"
            variant="secondary"
            busy={action.busy}
            disabled={!!utr && !isValidUtr(utr)}
            onPress={() => void run(() => claimPayment(b.id, utr || undefined))}
          />
        </>
      );
      break;
    case "confirm_payment":
      body = (
        <>
          <P>
            {b.borrower.displayName} says they paid {formatPaise(b.feePaise)}
            {p?.depositMode === "p2p" && b.depositPaise ? ` + ${formatPaise(b.depositPaise)} deposit` : ""}
            {p?.claimedAt ? ` on ${formatDateTime(p.claimedAt)}` : ""}.
          </P>
          {p?.utr ? <KV k="UTR" v={p.utr} /> : null}
          <P muted>Check your bank or UPI app before confirming.</P>
          <Button title="Received" icon="checkmark-circle" busy={action.busy} onPress={() => void run(() => confirmPayment(b.id))} />
        </>
      );
      break;
    case "handover_inspect":
      body = <Button title="Start handover inspection" icon="camera" onPress={() => go(`/booking/${b.id}/inspect?phase=handover`)} />;
      break;
    case "handover_ack":
      body = <Button title="Check their photos & checklist" icon="eye" onPress={() => go(`/booking/${b.id}/ack?phase=handover`)} />;
      break;
    case "return_inspect":
      body = <Button title="Start return inspection" icon="camera" onPress={() => go(`/booking/${b.id}/inspect?phase=return`)} />;
      break;
    case "review_return":
      body = <Button title="Review return side-by-side" icon="git-compare" onPress={() => go(`/booking/${b.id}/review`)} />;
      break;
    case "respond_dispute":
    case "wait_ruling":
      body = <Button title="Open dispute" icon="flag" variant={b.nextAction === "wait_ruling" ? "secondary" : "primary"} onPress={() => go(`/booking/${b.id}/dispute`)} />;
      break;
    case "refund_deposit":
      body = (
        <>
          <P muted>Send {formatPaise(refundDue)} of the deposit back to {b.borrower.displayName}.</P>
          <Button title="Refund deposit via UPI" icon="wallet" onPress={() => void pay(p?.refundUpiIntent)} />
          <Button title="I've refunded it" variant="secondary" busy={action.busy} onPress={() => void run(() => depositRefundClaim(b.id))} />
        </>
      );
      break;
    case "confirm_refund":
      body = (
        <>
          <P muted>{b.lender.displayName} says they refunded {formatPaise(refundDue)} of your deposit. Check your bank app.</P>
          <Button title="Refund received" icon="checkmark-circle" busy={action.busy} onPress={() => void run(() => depositRefundConfirm(b.id))} />
        </>
      );
      break;
    case "pay_award":
      body = (
        <>
          <P muted>Pay the {formatPaise(awardDue)} award to {awardPayee?.displayName ?? "the other party"}.</P>
          <Button title="Pay award via UPI" icon="wallet" onPress={() => void pay(p?.awardUpiIntent)} />
          <Button title="I've paid the award" variant="secondary" busy={action.busy} onPress={() => void run(() => awardPaidClaim(b.id))} />
        </>
      );
      break;
    case "confirm_award":
      body = (
        <>
          <P muted>{awardPayer?.displayName ?? "The other party"} says they paid the {formatPaise(awardDue)} award.</P>
          <Button title="Received" icon="checkmark-circle" busy={action.busy} onPress={() => void run(() => awardPaidConfirm(b.id))} />
        </>
      );
      break;
    case "rate":
      body = <Button title="Rate this booking" icon="star" onPress={() => go(`/booking/${b.id}/rate`)} />;
      break;
    default:
      body = null;
  }

  return (
    <Card style={!isWaiting(b.nextAction) ? { borderColor: colors.accent, borderWidth: 1.5 } : undefined}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <H2>{label}</H2>
        <Countdown to={b.deadlineAt} prefix="in" overdueText="Deadline passed" />
      </View>
      {body}
      <ErrorText>{upiError}</ErrorText>
      <ErrorText>{action.error}</ErrorText>
    </Card>
  );
}

function EvidenceLinks({ b }: { b: BookingDetail }) {
  const router = useRouter();
  const rows: React.ReactNode[] = [];
  for (const phase of ["handover", "return"] as const) {
    const mine = myInspection(b, phase);
    const theirs = otherInspection(b, phase);
    if (!mine && !theirs) continue;
    rows.push(
      <View key={phase} style={{ gap: 6 }}>
        <Text style={{ fontWeight: "700", color: colors.fg }}>{phase === "handover" ? "Handover" : "Return"}</Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {mine ? <Chip label={`You ✓ ${formatDateTime(mine.submittedAt)}`} tone={mine.withinGeofence ? "good" : "warn"} /> : null}
          {theirs ? (
            <Chip
              label={`${theirs.party === "lender" ? "Lender" : "Borrower"} ✓${theirs.ack ? ` · ${theirs.ack.result}` : ""}`}
              tone={theirs.ack?.result === "objected" ? "bad" : "info"}
              onPress={() => router.push((phase === "return" && b.myRole === "lender" ? `/booking/${b.id}/review` : `/booking/${b.id}/ack?phase=${phase}`) as never)}
            />
          ) : null}
          {mine && !fenceFlag(mine).ok ? <Chip label={fenceFlag(mine).label} tone="warn" /> : null}
        </View>
      </View>,
    );
  }
  // Borrower may need to capture their own handover photos alongside acking the lender's.
  if (b.state === "HANDOVER_PENDING" && !myInspection(b, "handover") && b.nextAction !== "handover_inspect" && b.photoSlotsSnapshot.length) {
    rows.push(
      <Button key="cap" title="Capture my handover photos" variant="secondary" icon="camera" onPress={() => router.push(`/booking/${b.id}/inspect?phase=handover` as never)} />,
    );
  }
  if (!rows.length) return null;
  return (
    <Card>
      <H2>Inspections</H2>
      {rows}
    </Card>
  );
}

function DisputeSummary({ b }: { b: BookingDetail }) {
  const router = useRouter();
  const d = b.dispute!;
  return (
    <Card>
      <H2 right={<Countdown to={d.deadlineAt} prefix="ruling in" />}>Dispute · {disputeCategoryLabel(d.category)}</H2>
      <KV k="Claimed" v={formatPaise(d.claimedPaise)} />
      {d.offerPaise !== null ? <KV k="Offer" v={formatPaise(d.offerPaise)} /> : null}
      {d.awardPaise !== null ? <KV k="Award" v={formatPaise(d.awardPaise)} /> : null}
      <KV k="Status" v={d.status} />
      <Button title="Open dispute" variant="secondary" onPress={() => router.push(`/booking/${b.id}/dispute` as never)} />
    </Card>
  );
}

function CancelButton({ b, onUpdate }: { b: BookingDetail; onUpdate: (d: BookingDetail) => void }) {
  const action = useAction();
  return (
    <>
      <ErrorText>{action.error}</ErrorText>
      <Button
        title="Cancel booking"
        variant="danger"
        busy={action.busy}
        onPress={() =>
          Alert.alert("Cancel this booking?", b.payment?.confirmedAt ? "You'll need to sort out the UPI refund between yourselves." : undefined, [
            { text: "Keep it", style: "cancel" },
            {
              text: "Cancel booking",
              style: "destructive",
              onPress: async () => {
                await action.run(async () => onUpdate(await cancelBooking(b.id)));
              },
            },
          ])
        }
      />
    </>
  );
}

function ReportIssueLink({ id }: { id: string }) {
  const router = useRouter();
  return <Button title="Report an issue" icon="flag" variant="ghost" onPress={() => router.push(`/booking/${id}/dispute` as never)} />;
}
