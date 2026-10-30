"use client";

import { CheckCircle2, Clock, Flag, Gavel, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ACTION_COPY, Timeline } from "@/components/bookings";
import { ErrorText, LoadError, Loading, Panel, PanelTitle, StateBadge, TrustBadge } from "@/components/common";
import { DisputeSummary, EvidencePicker, RaiseDisputeForm, RatingForm, RespondDisputeForm, uploadEvidence } from "@/components/disputes";
import { CaptureInApp, Comparison, InspectionView } from "@/components/inspections";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { UpiPay } from "@/components/UpiPay";
import * as api from "@/lib/api";
import { formatCountdown, formatINR, formatIST, formatRange } from "@/lib/format";
import { useAction, useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { BookingDetail, BookingState, InspectionPhase } from "@/lib/types";

const CANCELLABLE: BookingState[] = ["REQUESTED", "ACCEPTED", "DEPOSIT_HELD", "HANDOVER_PENDING"];
const DISPUTABLE: BookingState[] = ["HANDOVER_PENDING", "ACTIVE", "OVERDUE", "RETURN_PENDING"];

const DEPOSIT_STATUS: Record<string, string> = {
  none: "No deposit",
  pending: "Not paid yet",
  declared: "Declared (no money moved)",
  held_by_lender: "Held by the lender",
  refund_claimed: "Lender says it's refunded",
  refunded: "Refunded",
  released: "Released",
};
const AWARD_STATUS: Record<string, string> = {
  none: "No award",
  debt_recorded: "Owed",
  settled_from_deposit: "Settled from the deposit",
  paid_claimed: "Payer says it's paid",
  paid: "Paid",
};

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const booking = useAsync(() => api.getBooking(id), `booking:${id}`);

  if (booking.error) return <LoadError error={booking.error} onRetry={booking.reload} />;
  if (!booking.data) return <Loading />;
  return <Detail b={booking.data} set={booking.setData} reload={booking.reload} />;
}

function Detail({ b, set, reload }: { b: BookingDetail; set: (b: BookingDetail) => void; reload: () => void }) {
  const { user } = useSession();
  const action = useAction();
  const [disputing, setDisputing] = useState(false);
  const me = b.myRole;
  const isSkill = b.listing.kind === "skill";
  const other = me === "lender" ? b.borrower : b.lender;
  const nameOf = (uid: string | null | undefined) =>
    uid === b.lender.id ? b.lender.displayName : uid === b.borrower.id ? b.borrower.displayName : "the other party";
  const partyName = (uid: string) =>
    uid === b.lender.id ? `${b.lender.displayName} (lender)` : uid === b.borrower.id ? `${b.borrower.displayName} (borrower)` : "a party";

  // Every booking action returns the fresh BookingDetail: render it, no refetch.
  const act = (fn: () => Promise<BookingDetail>) =>
    action.run(async () => set(await fn()), api.errorMessage);

  const p = b.payment;
  const next = b.nextAction;
  const copy = next ? ACTION_COPY[next] : null;
  const handoverByOther = b.inspections.find((i) => i.phase === "handover" && i.party !== me);
  const returnInsp = b.inspections.find((i) => i.phase === "return");
  const objectedReturn = returnInsp?.ack?.result === "objected";
  const hasReturn = !!returnInsp;
  const iPayAward = p?.awardPayerId === user.id;
  const iGetAward = p?.awardPayeeId === user.id;
  const awardDue = p?.awardPaise != null ? p.awardPaise - (p.awardFromDepositPaise ?? 0) : null;
  const canDispute = me !== "admin" && DISPUTABLE.includes(b.state) && !b.dispute && next !== "review_return";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-4">
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-fg-muted">
                Booking BV-{b.id.slice(0, 8)} · {b.society.name}
              </p>
              <h1 className="text-xl font-semibold tracking-tight">
                <Link href={`/listings/${b.listing.id}`} className="hover:text-accent">
                  {b.listing.title}
                </Link>
              </h1>
              <p className="text-sm text-fg-muted">
                {formatRange(b.startsAt, b.endsAt)} · {b.pricing}
              </p>
            </div>
            <StateBadge state={b.state} />
          </div>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            {(
              [
                ["Lender", b.lender],
                ["Borrower", b.borrower],
              ] as const
            ).map(([label, party]) => (
              <div key={label} className="rounded-xl bg-zinc-50 p-3">
                <p className="text-xs text-fg-muted">{label}</p>
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {party.displayName}
                  <span className="font-normal text-fg-muted">
                    {party.towerName}-{party.flatNo}
                  </span>
                  <TrustBadge trust={party.trust} compact />
                </p>
              </div>
            ))}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-fg-muted">Fee</dt>
              <dd className="font-medium">{formatINR(b.feePaise)}</dd>
            </div>
            {!isSkill ? (
              <div>
                <dt className="text-fg-muted">Deposit</dt>
                <dd className="font-medium">{formatINR(b.depositPaise)}</dd>
              </div>
            ) : null}
            {p && !isSkill ? (
              <div>
                <dt className="text-fg-muted">Deposit mode</dt>
                <dd className="font-medium">{p.depositMode === "p2p" ? "Paid to lender (P2P)" : "Declared only"}</dd>
              </div>
            ) : null}
          </dl>
        </Panel>

        {/* ---- what to do now ---- */}
        <Panel className={copy?.mine ? "border-accent/40 ring-1 ring-accent/20" : ""}>
          <PanelTitle
            aside={
              b.deadlineAt ? (
                <span className="flex items-center gap-1 text-xs text-fg-muted" title={formatIST(b.deadlineAt)}>
                  <Clock className="size-3.5" /> {formatCountdown(b.deadlineAt)}
                </span>
              ) : null
            }
          >
            {copy ? copy.label : "Nothing to do right now"}
          </PanelTitle>

          {next === "accept_or_decline" ? (
            <div className="flex flex-wrap gap-2">
              <Button disabled={action.busy} onClick={() => act(() => api.acceptBooking(b.id))}>
                <CheckCircle2 /> Accept
              </Button>
              <Button variant="outline" disabled={action.busy} onClick={() => act(() => api.declineBooking(b.id))}>
                <XCircle /> Decline
              </Button>
            </div>
          ) : null}

          {next === "pay" && p ? <PayStep b={b} set={set} /> : null}

          {next === "confirm_payment" && p ? (
            <div className="space-y-3 text-sm">
              <p>
                {p.claimedAt ? (
                  <>
                    {b.borrower.displayName} says they paid on {formatIST(p.claimedAt)}
                    {p.utr ? (
                      <>
                        {" "}
                        (UTR <span className="font-mono">{p.utr}</span>)
                      </>
                    ) : null}
                    .{" "}
                  </>
                ) : (
                  <>{b.borrower.displayName} hasn&apos;t marked it paid yet, but you can confirm as soon as the money arrives. </>
                )}
                Check your UPI app or bank statement before confirming.
              </p>
              <Button disabled={action.busy} onClick={() => act(() => api.confirmPayment(b.id))}>
                <CheckCircle2 /> Yes, I received {formatINR(p.feePaise + (p.depositMode === "p2p" ? p.depositPaise : 0))}
              </Button>
            </div>
          ) : null}

          {next === "handover_inspect" ? <CaptureInApp phase="handover" /> : null}

          {next === "return_inspect" ? (
            isSkill ? (
              <div className="space-y-2 text-sm">
                <p className="text-fg-muted">Once {b.lender.displayName} has delivered the service, confirm it here.</p>
                <Button
                  disabled={action.busy}
                  onClick={() =>
                    action
                      .run(async () => {
                        await api.submitInspection(b.id, { phase: "return", mediaIds: [], checklistAnswers: {}, geo: await api.tryGeo() });
                      }, api.errorMessage)
                      .then((ok) => ok && reload())
                  }
                >
                  <CheckCircle2 /> Mark as delivered
                </Button>
              </div>
            ) : (
              <CaptureInApp phase="return" />
            )
          ) : null}

          {next === "handover_ack" ? (
            handoverByOther ? (
              <div className="space-y-3">
                <InspectionView insp={handoverByOther} checklist={b.checklistSnapshot} />
                <AckForm
                  bookingId={b.id}
                  phase="handover"
                  question="Does the item match these photos and checklist?"
                  agreeLabel="Yes, matches. Start the rental"
                  onDone={set}
                />
              </div>
            ) : (
              <CaptureInApp phase="handover" />
            )
          ) : null}

          {next === "review_return" ? (
            <div className="space-y-4">
              <Comparison inspections={b.inspections} checklist={b.checklistSnapshot} slots={b.photoSlotsSnapshot} />
              {objectedReturn ? (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  You objected to the return. Raise a dispute before the deadline, or the booking completes automatically.
                </p>
              ) : (
                <AckForm
                  bookingId={b.id}
                  phase="return"
                  question={isSkill ? "Was it delivered as agreed?" : "Is everything as it was at handover?"}
                  agreeLabel="All good. Close the booking"
                  onDone={set}
                />
              )}
              <Button variant={objectedReturn ? "destructive" : "outline"} onClick={() => setDisputing(true)}>
                <Flag /> Raise a dispute
              </Button>
            </div>
          ) : null}

          {next === "respond_dispute" && b.dispute ? (
            <div className="space-y-4">
              <DisputeSummary d={b.dispute} partyName={partyName} />
              <RespondDisputeForm bookingId={b.id} claimedPaise={b.dispute.claimedPaise} onDone={set} />
            </div>
          ) : null}

          {next === "wait_ruling" && b.dispute ? (
            <div className="space-y-3">
              <p className="text-sm text-fg-muted">
                A society admin who isn&apos;t involved will compare the evidence and rule. If nobody rules within 72 hours, it goes to
                3PandaLabs.
              </p>
              {b.dispute.offerPaise != null && b.dispute.raisedBy !== other.id && !b.dispute.resolvedAt ? (
                <div className="rounded-xl border border-line p-3 text-sm">
                  <p>
                    {other.displayName} offered <span className="font-medium">{formatINR(b.dispute.offerPaise)}</span> to settle.
                  </p>
                  <Button className="mt-2" size="sm" disabled={action.busy} onClick={() => act(() => api.acceptOffer(b.id))}>
                    Accept {formatINR(b.dispute.offerPaise)} and settle
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {next === "refund_deposit" ? (
            <div className="space-y-3">
              {p?.refundUpiIntent ? (
                <UpiPay intent={p.refundUpiIntent} label={`Refund ${formatINR(p.refundDuePaise)} of the deposit to ${b.borrower.displayName}`} />
              ) : null}
              <Button disabled={action.busy} onClick={() => act(() => api.refundClaim(b.id))}>
                I&apos;ve refunded the deposit
              </Button>
            </div>
          ) : null}
          {next === "confirm_refund" ? (
            <div className="space-y-2 text-sm">
              <p>
                {b.lender.displayName} says they refunded {formatINR(p?.refundDuePaise)}
                {p?.refundClaimedAt ? ` on ${formatIST(p.refundClaimedAt)}` : ""}. Check your UPI app.
              </p>
              <Button disabled={action.busy} onClick={() => act(() => api.refundConfirm(b.id))}>
                <CheckCircle2 /> Refund received
              </Button>
            </div>
          ) : null}

          {next === "pay_award" && iPayAward ? (
            <div className="space-y-3">
              {p?.awardUpiIntent ? (
                <UpiPay intent={p.awardUpiIntent} label={`Pay the dispute award to ${nameOf(p.awardPayeeId)}`} />
              ) : null}
              <Button disabled={action.busy} onClick={() => act(() => api.awardPaidClaim(b.id))}>
                I&apos;ve paid {awardDue != null ? formatINR(awardDue) : "the award"}
              </Button>
            </div>
          ) : null}
          {next === "confirm_award" && iGetAward ? (
            <div className="space-y-2 text-sm">
              <p>
                {nameOf(p?.awardPayerId)} says they paid the award of {awardDue != null ? formatINR(awardDue) : "the award"}. Check your
                UPI app.
              </p>
              <Button disabled={action.busy} onClick={() => act(() => api.awardPaidConfirm(b.id))}>
                <CheckCircle2 /> Award received
              </Button>
            </div>
          ) : null}

          {next === "rate" ? <RatingForm bookingId={b.id} otherName={other.displayName} onDone={reload} /> : null}

          {next && next.startsWith("wait_") && next !== "wait_ruling" ? (
            <p className="text-sm text-fg-muted">This moves on as soon as {other.displayName} acts. Nothing needed from you.</p>
          ) : null}

          {me === "admin" ? (
            <p className="text-sm text-fg-muted">
              You&apos;re viewing this as an admin. Rule on it from the{" "}
              <Link href={`/admin/${b.society.id}/disputes/${b.id}`} className="text-accent hover:underline">
                arbitration view
              </Link>
              .
            </p>
          ) : null}

          {!next && me !== "admin" ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/listings">
                <Button size="sm" variant="outline">
                  Browse more listings
                </Button>
              </Link>
              <Link href="/bookings">
                <Button size="sm" variant="ghost">
                  All bookings
                </Button>
              </Link>
            </div>
          ) : null}

          <ErrorText>{action.error}</ErrorText>

          {me !== "admin" && (CANCELLABLE.includes(b.state) || canDispute) ? (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              {CANCELLABLE.includes(b.state) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={action.busy}
                  onClick={() => {
                    if (window.confirm("Cancel this booking?")) act(() => api.cancelBooking(b.id));
                  }}
                >
                  {action.busy ? <Loader2 className="animate-spin" /> : null} Cancel booking
                </Button>
              ) : null}
              {canDispute ? (
                <Button size="sm" variant="ghost" onClick={() => setDisputing(true)}>
                  <Flag /> Report a problem
                </Button>
              ) : null}
            </div>
          ) : null}
        </Panel>

        {disputing ? (
          <Panel>
            <PanelTitle>Raise a dispute</PanelTitle>
            <RaiseDisputeForm
              bookingId={b.id}
              onCancel={() => setDisputing(false)}
              onDone={(fresh) => {
                setDisputing(false);
                set(fresh);
              }}
            />
          </Panel>
        ) : null}

        {b.dispute && next !== "respond_dispute" ? (
          <Panel>
            <PanelTitle aside={<Gavel className="size-4 text-fg-muted" />}>Dispute</PanelTitle>
            <DisputeSummary d={b.dispute} partyName={partyName} />
          </Panel>
        ) : null}

        {p && next !== "pay" ? (
          <Panel>
            <PanelTitle>Payment</PanelTitle>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-fg-muted">Borrower marked paid</dt>
              <dd>{p.claimedAt ? formatIST(p.claimedAt) : "Not yet"}</dd>
              <dt className="text-fg-muted">Lender confirmed</dt>
              <dd>{p.confirmedAt ? formatIST(p.confirmedAt) : "Not yet"}</dd>
              {p.utr ? (
                <>
                  <dt className="text-fg-muted">UTR</dt>
                  <dd className="font-mono">{p.utr}</dd>
                </>
              ) : null}
              {!isSkill ? (
                <>
                  <dt className="text-fg-muted">Deposit</dt>
                  <dd>{DEPOSIT_STATUS[p.depositStatus] ?? p.depositStatus}</dd>
                </>
              ) : null}
              {p.awardStatus !== "none" ? (
                <>
                  <dt className="text-fg-muted">Award</dt>
                  <dd>
                    {formatINR(p.awardPaise)} · {AWARD_STATUS[p.awardStatus] ?? p.awardStatus}
                    {p.awardFromDepositPaise ? ` (${formatINR(p.awardFromDepositPaise)} kept from the deposit)` : ""}
                    {p.awardPayerId ? ` · payer ${nameOf(p.awardPayerId)}` : ""}
                  </dd>
                </>
              ) : null}
            </dl>
          </Panel>
        ) : null}

        {b.inspections.length && next !== "review_return" ? (
          <Panel>
            <PanelTitle>Inspections</PanelTitle>
            {hasReturn && !isSkill ? (
              <Comparison inspections={b.inspections} checklist={b.checklistSnapshot} slots={b.photoSlotsSnapshot} />
            ) : (
              <div className="space-y-3">
                {b.inspections.map((i) => (
                  <InspectionView key={i.id} insp={i} checklist={b.checklistSnapshot} />
                ))}
              </div>
            )}
          </Panel>
        ) : null}
      </div>

      <div className="space-y-4">
        <Panel>
          <PanelTitle>Timeline</PanelTitle>
          <Timeline events={b.events} />
        </Panel>
      </div>
    </div>
  );
}

function PayStep({ b, set }: { b: BookingDetail; set: (b: BookingDetail) => void }) {
  const p = b.payment!;
  const [utr, setUtr] = useState("");
  const action = useAction();
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">
        Pay {b.lender.displayName} directly over UPI. BorrowVault never holds the money; {b.lender.displayName} confirms when it
        arrives.
      </p>
      <UpiPay intent={p.feeUpiIntent} label={`Rental fee, ${formatINR(p.feePaise)}`} />
      {p.depositMode === "p2p" && p.depositUpiIntent ? (
        <UpiPay intent={p.depositUpiIntent} label={`Deposit, ${formatINR(p.depositPaise)} (refunded over UPI after a clean return)`} />
      ) : null}
      {p.depositMode === "declared" && p.depositPaise ? (
        <p className="text-xs text-fg-muted">
          Your society uses declared deposits: no deposit money moves now. If a dispute awards damages, that amount is owed then.
        </p>
      ) : null}
      {p.claimedAt ? (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          You marked this paid {formatIST(p.claimedAt)}. Waiting for {b.lender.displayName} to confirm.
        </p>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => set(await api.claimPayment(b.id, utr.trim() || undefined)), api.errorMessage);
          }}
        >
          <div className="min-w-0 flex-1">
            <label htmlFor="utr" className="text-xs text-fg-muted">
              UPI reference / UTR (optional)
            </label>
            <Input id="utr" inputMode="numeric" maxLength={22} value={utr} onChange={(e) => setUtr(e.target.value)} />
          </div>
          <Button type="submit" disabled={action.busy}>
            {action.busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} I&apos;ve paid
          </Button>
        </form>
      )}
      <ErrorText>{action.error}</ErrorText>
    </div>
  );
}

/** Agree/object to the other party's inspection. Objections can carry up to 5 photos (slot "objection"). */
function AckForm({
  bookingId,
  phase,
  question,
  agreeLabel,
  onDone,
}: {
  bookingId: string;
  phase: InspectionPhase;
  question: string;
  agreeLabel: string;
  onDone: (b: BookingDetail) => void;
}) {
  const [objecting, setObjecting] = useState(false);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(result: "agreed" | "objected") {
    setError(null);
    setBusy("Sending…");
    try {
      const mediaIds = result === "objected" ? await uploadEvidence(bookingId, phase, () => "objection", files, setBusy) : [];
      setBusy("Sending…");
      onDone(
        await api.ackInspection(bookingId, {
          phase,
          result,
          ...(result === "objected" && note.trim() ? { note: note.trim() } : {}),
          ...(mediaIds.length ? { mediaIds } : {}),
        }),
      );
    } catch (err) {
      setError(api.errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{question}</p>
      {objecting ? (
        <div className="space-y-2">
          <Textarea placeholder="What's different?" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          <EvidencePicker files={files} setFiles={setFiles} max={5} />
          <div className="flex gap-2">
            <Button variant="destructive" disabled={!!busy || !note.trim()} onClick={() => send("objected")}>
              {busy ? <Loader2 className="animate-spin" /> : null} {busy ?? "Send objection"}
            </Button>
            <Button variant="ghost" onClick={() => setObjecting(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button disabled={!!busy} onClick={() => send("agreed")}>
            {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {agreeLabel}
          </Button>
          <Button variant="outline" disabled={!!busy} onClick={() => setObjecting(true)}>
            <XCircle /> Something&apos;s different
          </Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
