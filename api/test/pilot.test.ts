import { describe, expect, it } from "vitest";
import {
  assertMayRule,
  assertPilotListingValues,
  assertRoomForMember,
  PILOT_MAX_MEMBERS,
  PILOT_MAX_VALUE_PAISE,
  pilotFull,
} from "../src/lib/pilot.js";

// Pure pilot-society rules (api/ROUTES.md "Pilot societies").

describe("pilot member cap", () => {
  it("is 50 approved memberships, admins included", () => {
    expect(PILOT_MAX_MEMBERS).toBe(50);
    expect(pilotFull("pilot", 49)).toBe(false);
    expect(pilotFull("pilot", 50)).toBe(true);
    expect(() => assertRoomForMember("pilot", 49)).not.toThrow();
  });
  it("the 51st approval fails with 409 society_full", () => {
    expect(() => assertRoomForMember("pilot", 50)).toThrow(expect.objectContaining({ code: "CONFLICT", message: "society_full", status: 409 }));
  });
  it("verified societies have no cap", () => {
    expect(pilotFull("verified", 5000)).toBe(false);
    expect(() => assertRoomForMember("verified", 5000)).not.toThrow();
  });
});

describe("pilot listing value cap (₹5,000)", () => {
  it("allows up to 500000 paise for deposit and replacement value", () => {
    expect(PILOT_MAX_VALUE_PAISE).toBe(500_000);
    expect(() => assertPilotListingValues("pilot", { depositPaise: 500_000, replacementValuePaise: 500_000 })).not.toThrow();
    expect(() => assertPilotListingValues("pilot", { depositPaise: 0, replacementValuePaise: null })).not.toThrow();
  });
  it("rejects either value above it with 400 pilot_value_cap", () => {
    for (const l of [{ depositPaise: 500_001 }, { depositPaise: 0, replacementValuePaise: 500_001 }]) {
      expect(() => assertPilotListingValues("pilot", l)).toThrow(
        expect.objectContaining({ code: "VALIDATION", message: "pilot_value_cap", status: 400 }),
      );
    }
  });
  it("verified societies aren't capped", () => {
    expect(() => assertPilotListingValues("verified", { depositPaise: 5_000_000, replacementValuePaise: 9_000_000 })).not.toThrow();
  });
});

describe("who rules disputes", () => {
  it("pilot: platform admins only", () => {
    expect(() => assertMayRule("pilot", false)).toThrow(expect.objectContaining({ code: "FORBIDDEN", message: "pilot_platform_rules" }));
    expect(() => assertMayRule("pilot", true)).not.toThrow();
  });
  it("verified: society admins too", () => {
    expect(() => assertMayRule("verified", false)).not.toThrow();
  });
});
