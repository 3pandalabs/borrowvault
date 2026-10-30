import type { ChecklistAnswer, ChecklistItem } from "./types";

export function isAnswered(item: ChecklistItem, a: ChecklistAnswer | undefined): boolean {
  if (!a) return false;
  switch (item.type) {
    case "bool":
      return typeof a.ok === "boolean";
    case "percent":
      return typeof a.value === "number" && a.value >= 0 && a.value <= 100;
    case "count":
      return typeof a.value === "number" && Number.isInteger(a.value) && a.value >= 0;
    case "choice":
      return typeof a.value === "string" && (item.options ?? []).includes(a.value);
    case "text":
      return typeof a.value === "string" && a.value.trim().length > 0;
    default:
      return false;
  }
}

export function allAnswered(items: ChecklistItem[], answers: Record<string, ChecklistAnswer>): boolean {
  return items.every((i) => isAnswered(i, answers[i.id]));
}

export function answerText(item: ChecklistItem, a: ChecklistAnswer | undefined): string {
  if (!a) return "—";
  switch (item.type) {
    case "bool":
      return a.ok === undefined ? "—" : a.ok ? "Yes" : "No";
    case "percent":
      return a.value === undefined ? "—" : `${a.value}%`;
    default:
      return a.value === undefined || a.value === "" ? "—" : String(a.value);
  }
}

/** True when the return answer differs from the handover answer (the 6.3 ⚠ marker). */
export function answerDiffers(
  item: ChecklistItem,
  before: ChecklistAnswer | undefined,
  after: ChecklistAnswer | undefined,
): boolean {
  if (!before || !after) return !!before !== !!after;
  if (item.type === "bool") return before.ok !== after.ok;
  const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v);
  return norm(before.value) !== norm(after.value);
}
