"use client";

import { ArrowLeft, Gavel, Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Timeline } from "@/components/bookings";
import { ErrorText, Field, LoadError, Loading, Panel, PanelTitle, StateBadge, TrustBadge } from "@/components/common";
import { DisputeSummary } from "@/components/disputes";
import { Comparison, InspectionView } from "@/components/inspections";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import * as api from "@/lib/api";
import { formatCountdown, formatINR, formatRange, paiseToRupeesInput, rupeesToPaise } from "@/lib/format";
import { useAction, useAsync } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { BookingDetail } from "@/lib/types";

export default function ArbitrationPage() {
  const { societyId, bookingId } = useParams<{ societyId: string; bookingId: string }>();
  const booking = useAsync(() => api.getBooking(bookingId), `booking:${bookingId}`);

  return (
    <>
      <Link href={`/admin/${societyId}?tab=disputes`} className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> All disputes
      </Link>
      {booking.error ? (
        <LoadError error={booking.error} onRetry={booking.reload} />
      ) : !booking.data ? (
        <Loading />
      ) : (
        <Arbitration b={booking.data} set={booking.setData} />
      )}
    </>
  );
}

function Arbitration({ b, set }: { b: BookingDetail; set: (b: BookingDetail) => void }) {
  const { user } = useSession();
  const d = b.dispute;
  const isParty = user.id === b.lender.id || user.id === b.borrower.id;
  const partyName = (uid: string) =>
    uid === b.lender.id ? `${b.lender.displayName} (lender)` : uid === b.borrower.id ? `${b.borrower.displayName} (borrower)` : "a party";

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs text-fg-muted">Dispute {d ? `#${d.id.slice(0, 8)}` : ""} · booking BV-{b.id.slice(0, 8)}</p>
            <h1 className="text-xl font-semibold tracking-tight">
              {b.listing.title} · {b.lender.towerName}-{b.lender.flatNo} vs {b.borrower.towerName}-{b.borrower.flatNo}
            </h1>
            <p className="text-sm text-fg-muted">{formatRange(b.startsAt, b.endsAt)}</p>
          </div>
          <StateBadge state={b.state} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            Lender: <span className="font-medium">{b.lender.displayName}</span> <TrustBadge trust={b.lender.trust} compact />
          </span>
          <span>
            Borrower: <span className="font-medium">{b.borrower.displayName}</span> <TrustBadge trust={b.borrower.trust} compact />
          </span>
        </div>
        {d ? (
          <p className="mt-3 text-sm">
            Claim <span className="font-semibold">{formatINR(d.claimedPaise)}</span>
            {d.offerPaise != null ? (
              <>
                {" "}
                · Offer <span className="font-semibold">{formatINR(d.offerPaise)}</span>
              </>
            ) : null}{" "}
            · Deposit <span className="font-semibold">{formatINR(b.depositPaise)}</span>
            {d.deadlineAt && !d.resolvedAt ? <span className="text-fg-muted"> · {formatCountdown(d.deadlineAt)} until escalation</span> : null}
          </p>
        ) : null}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelTitle>Handover vs return evidence</PanelTitle>
            <Comparison inspections={b.inspections} checklist={b.checklistSnapshot} slots={b.photoSlotsSnapshot} />
          </Panel>
          {b.inspections.length > 2 ? (
            <Panel>
              <PanelTitle>Every inspection</PanelTitle>
              <div className="space-y-3">
                {b.inspections.map((i) => (
                  <InspectionView key={i.id} insp={i} checklist={b.checklistSnapshot} />
                ))}
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-4">
          {d ? (
            <Panel>
              <PanelTitle>Claim & response</PanelTitle>
              <DisputeSummary d={d} partyName={partyName} />
            </Panel>
          ) : null}

          {d && !d.resolvedAt && b.state === "DISPUTED" ? (
            isParty ? (
              <Panel className="border-amber-200 bg-amber-50 text-sm text-amber-900">
                <p className="flex items-center gap-2 font-medium">
                  <ShieldAlert className="size-4" /> You can&apos;t rule on this one
                </p>
                <p className="mt-1">You&apos;re a party to this booking. Another society admin, or 3PandaLabs, has to rule.</p>
              </Panel>
            ) : (
              <RulingForm b={b} onDone={set} />
            )
          ) : null}

          <Panel>
            <PanelTitle>Timeline</PanelTitle>
            <Timeline events={b.events} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function RulingForm({ b, onDone }: { b: BookingDetail; onDone: (b: BookingDetail) => void }) {
  const d = b.dispute!;
  // Awards are capped by the claim only. They can exceed the deposit: the
  // excess becomes a recorded debt (ROUTES.md, disputes).
  const max = d.claimedPaise;
  const winner =
    d.raisedBySystem || d.raisedBy === "system" || d.raisedBy === b.borrower.id ? b.borrower.displayName : b.lender.displayName;
  const [award, setAward] = useState(paiseToRupeesInput(d.offerPaise ?? null));
  const [note, setNote] = useState("");
  const action = useAction();
  const paise = rupeesToPaise(award);
  const err =
    award.trim() && paise === null
      ? "Enter the award in rupees."
      : paise !== null && paise > d.claimedPaise
        ? `The award can't exceed the claim (${formatINR(d.claimedPaise)}).`
        : null;

  return (
    <Panel>
      <PanelTitle aside={<Gavel className="size-4 text-fg-muted" />}>Your ruling</PanelTitle>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (err || paise === null) return;
          if (!window.confirm(`Award ${formatINR(paise)} to ${winner}? This resolves the dispute and can't be undone.`)) return;
          action.run(async () => onDone(await api.ruleDispute(b.id, { awardPaise: paise, note: note.trim() })), api.errorMessage);
        }}
      >
        <Field label={`Award to ${winner} (₹)`} htmlFor="award" hint={`0 to ${formatINR(max)} (the claim). Anything above the ${formatINR(b.depositPaise)} deposit becomes a debt the other side pays over UPI.`} error={err}>
          <Input id="award" inputMode="decimal" value={award} onChange={(e) => setAward(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setAward("0")}>
            ₹0
          </Button>
          {d.offerPaise != null && d.offerPaise <= max ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setAward(paiseToRupeesInput(d.offerPaise))}>
              Offer {formatINR(d.offerPaise)}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={() => setAward(paiseToRupeesInput(max))}>
            Max {formatINR(max)}
          </Button>
        </div>
        <Field label="Ruling note" htmlFor="note" hint="Both parties see this. Say what the evidence showed.">
          <Textarea id="note" required rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorText>{action.error}</ErrorText>
        <Button type="submit" className="w-full" disabled={action.busy || !!err || paise === null || !note.trim()}>
          {action.busy ? <Loader2 className="animate-spin" /> : <Gavel />} Rule
        </Button>
        <p className="text-xs text-fg-muted">
          Not sure? Leave it: unruled disputes escalate to 3PandaLabs automatically after 72 hours.
        </p>
      </form>
    </Panel>
  );
}
