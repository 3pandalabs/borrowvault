import { formatINR } from "./format";
import type { ListingSummary } from "./types";

export function priceLine(l: Pick<ListingSummary, "hourlyPaise" | "dailyPaise" | "weekendPaise">) {
  const parts: string[] = [];
  if (l.hourlyPaise) parts.push(`${formatINR(l.hourlyPaise)}/hr`);
  if (l.dailyPaise) parts.push(`${formatINR(l.dailyPaise)}/day`);
  if (l.weekendPaise) parts.push(`${formatINR(l.weekendPaise)}/weekend`);
  return parts.join(" · ") || "Price on request";
}

// Mirrors api/src/lib/categories.ts labels; unknown keys fall back to "pet_sitting" -> "Pet sitting".
const CATEGORY_LABELS: Record<string, string> = {
  power_tools: "Power tools",
  camera: "Cameras & lenses",
  camping: "Camping gear",
  baby: "Baby gear",
  party: "Party supplies",
  kitchen: "Kitchen appliances",
  sports: "Sports & fitness",
  baking: "Home baking",
  tutoring: "Tutoring",
  pet_sitting: "Pet sitting",
  home_assembly: "Home assembly & repairs",
};

export function categoryLabel(key: string): string {
  const known = CATEGORY_LABELS[key];
  if (known) return known;
  const words = key.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}
