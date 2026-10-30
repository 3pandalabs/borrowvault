"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { formatCountdown, formatINR, formatIST, formatRange } from "@/lib/format";
import type { Booking, BookingEvent, NextAction } from "@/lib/types";
import { StateBadge } from "./common";

/** Call-to-action copy for each `nextAction` (ROUTES.md), so the list never re-derives the state machine. */
export const ACTION_COPY: Record<NextAction, { label: string; mine: boolean }> = {
  accept_or_decline: { label: "Accept or decline", mine: true },
  wait_lender: { label: "Waiting for the lender to accept", mine: false },
  pay: { label: "Pay over UPI", mine: true },
  confirm_payment: { label: "Confirm you received payment", mine: true },
  wait_payment: { label: "Waiting for payment", mine: false },
  handover_inspect: { label: "Do the handover inspection in the app", mine: true },
  handover_ack: { label: "Confirm the handover", mine: true },
  wait_handover: { label: "Waiting for the other side's handover", mine: false },
  return_inspect: { label: "Do the return inspection in the app", mine: true },
  review_return: { label: "Review the return", mine: true },
  wait_review: { label: "Waiting for the lender's review", mine: false },
  respond_dispute: { label: "Respond to the dispute", mine: true },
  wait_ruling: { label: "Waiting for a ruling", mine: false },
  refund_deposit: { label: "Refund the deposit over UPI", mine: true },
  confirm_refund: { label: "Confirm the deposit refund", mine: true },
  pay_award: { label: "Pay the dispute award", mine: true },
  confirm_award: { label: "Confirm the award payment", mine: true },
  rate: { label: "Rate your neighbour", mine: true },
};

export function BookingRow({ booking: b }: { booking: Booking }) {
  const other = b.myRole === "lender" ? b.borrower : b.lender;
  const action = b.nextAction ? ACTION_COPY[b.nextAction] : null;
  return (
    <Link href={`/bookings/${b.id}`} className="flex items-center gap-3 py-3 hover:bg-zinc-50/60 sm:px-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{b.listing.title}</span>
          <StateBadge state={b.state} />
        </div>
        <p className="text-sm text-fg-muted">
          {b.myRole === "lender" ? "Lending to" : b.myRole === "borrower" ? "Borrowing from" : "Between"} {other.displayName} (
          {other.towerName}-{other.flatNo}) · {formatRange(b.startsAt, b.endsAt)} · {formatINR(b.feePaise)}
        </p>
        {action ? (
          <p className={`mt-0.5 text-sm ${action.mine ? "font-medium text-accent" : "text-fg-muted"}`}>
            {action.label}
            {b.deadlineAt ? <span className="font-normal text-fg-muted"> · due {formatCountdown(b.deadlineAt)}</span> : null}
          </p>
        ) : null}
      </div>
      <ChevronRight className="size-4 shrink-0 text-fg-muted" />
    </Link>
  );
}

export function Timeline({ events }: { events: BookingEvent[] }) {
  if (!events.length) return <p className="text-sm text-fg-muted">No events yet.</p>;
  return (
    <ol className="relative space-y-3 border-l border-line pl-4">
      {events.map((e, i) => (
        <li key={i} className="text-sm">
          <span className="absolute -left-1 mt-1.5 size-2 rounded-full bg-accent" />
          <p>
            <span className="font-medium">{e.toState.replaceAll("_", " ").toLowerCase()}</span>
            {e.reason ? <span className="text-fg-muted"> · {e.reason}</span> : null}
          </p>
          <p className="text-xs text-fg-muted">{formatIST(e.at)}</p>
        </li>
      ))}
    </ol>
  );
}
