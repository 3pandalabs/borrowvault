import { formatPaise } from "./format";
import type { Booking, DisputeCategory, NextAction, PricingUnit } from "./types";

export function priceLine(l: { hourlyPaise: number | null; dailyPaise: number | null; weekendPaise: number | null }) {
  const parts: string[] = [];
  if (l.hourlyPaise) parts.push(`${formatPaise(l.hourlyPaise)}/hr`);
  if (l.dailyPaise) parts.push(`${formatPaise(l.dailyPaise)}/day`);
  if (l.weekendPaise) parts.push(`${formatPaise(l.weekendPaise)}/weekend`);
  return parts.join(" · ") || "Price on request";
}

export const PRICING_LABEL: Record<PricingUnit, string> = {
  hourly: "Per hour",
  daily: "Per day",
  weekend: "Weekend",
};

/** One-line "what now" copy for each nextAction, from the caller's point of view. */
export const NEXT_ACTION_LABEL: Record<NextAction, string> = {
  accept_or_decline: "Accept or decline this request",
  wait_lender: "Waiting for the lender to respond",
  pay: "Pay the fee via UPI",
  confirm_payment: "Confirm you received the payment",
  wait_payment: "Waiting for payment",
  handover_inspect: "Take handover photos & checklist",
  handover_ack: "Check the other side's handover photos",
  wait_handover: "Waiting for the other side's handover",
  return_inspect: "Take return photos & checklist",
  review_return: "Review the returned item",
  wait_review: "Lender is reviewing the return",
  respond_dispute: "Respond to the dispute",
  wait_ruling: "Waiting for the society admin's ruling",
  refund_deposit: "Refund the deposit via UPI",
  confirm_refund: "Confirm you got the deposit back",
  pay_award: "Pay the dispute award via UPI",
  confirm_award: "Confirm you received the award",
  rate: "Rate this booking",
};

export function nextActionLabel(b: Pick<Booking, "nextAction">): string | null {
  return b.nextAction ? (NEXT_ACTION_LABEL[b.nextAction] ?? b.nextAction.replace(/_/g, " ")) : null;
}

/** Actions that are just waiting on someone else. */
export function isWaiting(a: NextAction | null): boolean {
  return !a || a.startsWith("wait_");
}

export const DISPUTE_CATEGORIES: { key: DisputeCategory; label: string }[] = [
  { key: "damage", label: "Damage" },
  { key: "missing_part", label: "Missing part" },
  { key: "not_returned", label: "Not returned" },
  { key: "not_as_described", label: "Not as described" },
  { key: "late", label: "Late" },
];

export function disputeCategoryLabel(c: string): string {
  return DISPUTE_CATEGORIES.find((d) => d.key === c)?.label ?? c;
}
