import { formatINR } from "./format";
import type { ListingSummary } from "./types";

export function priceLine(l: Pick<ListingSummary, "hourlyPaise" | "dailyPaise" | "weekendPaise">) {
  const parts: string[] = [];
  if (l.hourlyPaise) parts.push(`${formatINR(l.hourlyPaise)}/hr`);
  if (l.dailyPaise) parts.push(`${formatINR(l.dailyPaise)}/day`);
  if (l.weekendPaise) parts.push(`${formatINR(l.weekendPaise)}/weekend`);
  return parts.join(" · ") || "Price on request";
}
