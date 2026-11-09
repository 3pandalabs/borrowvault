import { describe, expect, it } from "vitest";
import { istDay, RECOMPUTE_DAYS, recomputeFrom } from "../src/lib/statsDays.js";

// Pure parts of the lifetime stats rollup (api/ROUTES.md "Lifetime stats").

describe("istDay", () => {
  it("uses the India calendar day, not UTC", () => {
    expect(istDay(new Date("2026-11-09T18:29:59Z"))).toBe("2026-11-09");
    expect(istDay(new Date("2026-11-09T18:30:00Z"))).toBe("2026-11-10"); // 00:00 IST
  });
});

describe("recomputeFrom", () => {
  it("backfills everything when the table is empty", () => {
    expect(recomputeFrom(new Date("2026-11-09T12:00:00Z"), true)).toBeNull();
  });
  it("otherwise recomputes only the last 3 IST days, today included", () => {
    expect(RECOMPUTE_DAYS).toBe(3);
    expect(recomputeFrom(new Date("2026-11-09T12:00:00Z"), false)).toBe("2026-11-07");
    expect(recomputeFrom(new Date("2026-03-01T20:00:00Z"), false)).toBe("2026-02-28"); // IST is already 2 March
  });
});
