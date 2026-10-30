import { describe, expect, it } from "vitest";
import { clockSkewed, haversineM, withinGeofence } from "../src/lib/geo.js";
import { priceFor, weekendWindow } from "../src/booking/pricing.js";
import { computeTrustScore } from "../src/booking/trust.js";

// Demo Heights centre (Bengaluru) with a 300 m radius.
const society = { centerLat: 12.9716, centerLng: 77.5946, radiusM: 300 };
// One degree of latitude ~ 111,195 m (R = 6,371 km).
const mPerDegLat = (Math.PI / 180) * 6_371_000;
const north = (m: number) => ({ lat: society.centerLat + m / mPerDegLat, lng: society.centerLng });

describe("haversineM", () => {
  it("is 0 for the same point", () => {
    expect(haversineM(12.9716, 77.5946, 12.9716, 77.5946)).toBe(0);
  });
  it("matches known distances", () => {
    expect(haversineM(0, 0, 1, 0)).toBeCloseTo(mPerDegLat, 0);
    // Bengaluru MG Road -> Kempegowda airport is ~ 30 km great-circle
    const d = haversineM(12.9756, 77.6066, 13.1986, 77.7066);
    expect(d).toBeGreaterThan(26_000);
    expect(d).toBeLessThan(28_000);
  });
  it("is symmetric", () => {
    expect(haversineM(12.97, 77.59, 13.0, 77.6)).toBeCloseTo(haversineM(13.0, 77.6, 12.97, 77.59), 6);
  });
});

describe("withinGeofence", () => {
  it("inside the radius", () => {
    expect(withinGeofence({ ...north(250), accuracyM: 5 }, society)).toBe(true);
  });
  it("just outside the radius with a precise fix", () => {
    expect(withinGeofence({ ...north(320), accuracyM: 5 }, society)).toBe(false);
  });
  it("accuracy widens the fence", () => {
    expect(withinGeofence({ ...north(320), accuracyM: 30 }, society)).toBe(true);
  });
  it("accuracy allowance is capped at 100 m", () => {
    expect(withinGeofence({ ...north(395), accuracyM: 2000 }, society)).toBe(true);
    expect(withinGeofence({ ...north(410), accuracyM: 2000 }, society)).toBe(false);
  });
  it("negative accuracy is treated as 0", () => {
    expect(withinGeofence({ ...north(310), accuracyM: -50 }, society)).toBe(false);
  });
});

describe("clockSkewed", () => {
  const recv = new Date("2026-11-01T10:00:00Z");
  it("flags > 10 min either way", () => {
    expect(clockSkewed(new Date("2026-11-01T09:49:00Z"), recv)).toBe(true);
    expect(clockSkewed(new Date("2026-11-01T10:11:00Z"), recv)).toBe(true);
    expect(clockSkewed(new Date("2026-11-01T09:55:00Z"), recv)).toBe(false);
  });
});

describe("priceFor", () => {
  const l = { hourlyPaise: 5000, dailyPaise: 30000, weekendPaise: 70000 };
  const s = new Date("2026-11-06T18:00:00Z");
  it("rounds hours and days up", () => {
    expect(priceFor(l, "hourly", s, new Date(s.getTime() + 90 * 60_000))).toBe(10000);
    expect(priceFor(l, "daily", s, new Date(s.getTime() + 25 * 3_600_000))).toBe(60000);
  });
  it("weekend is flat inside Fri 12:00 -> Mon 12:00 IST", () => {
    // 2026-11-06 is a Friday. 12:00 IST = 06:30Z; Monday 12:00 IST = 2026-11-09T06:30Z.
    const fri = (t: string) => new Date(`2026-11-06T${t}Z`);
    expect(priceFor(l, "weekend", fri("06:30:00"), new Date("2026-11-09T06:30:00Z"))).toBe(70000); // full window
    expect(priceFor(l, "weekend", new Date("2026-11-07T04:00:00Z"), new Date("2026-11-08T10:00:00Z"))).toBe(70000); // Sat -> Sun
    expect(priceFor(l, "weekend", new Date("2026-11-08T20:00:00Z"), new Date("2026-11-09T05:00:00Z"))).toBe(70000); // Mon 01:30 IST start
  });
  it("weekend rejects windows outside the same weekend", () => {
    expect(() => priceFor(l, "weekend", new Date("2026-11-06T06:29:00Z"), new Date("2026-11-07T06:00:00Z"))).toThrow(/Friday 12:00/); // Fri 11:59 IST
    expect(() => priceFor(l, "weekend", new Date("2026-11-07T06:00:00Z"), new Date("2026-11-09T06:31:00Z"))).toThrow(); // ends Mon 12:01 IST
    expect(() => priceFor(l, "weekend", new Date("2026-11-09T06:30:00Z"), new Date("2026-11-09T08:00:00Z"))).toThrow(); // starts Mon 12:00 IST
    expect(() => priceFor(l, "weekend", new Date("2026-11-04T06:00:00Z"), new Date("2026-11-04T10:00:00Z"))).toThrow(); // Wednesday
    expect(() => priceFor(l, "weekend", new Date("2026-11-08T06:00:00Z"), new Date("2026-11-14T06:00:00Z"))).toThrow(); // spans into next week
  });
  it("weekendWindow maps Sat/Sun/Mon-morning back to the same Friday", () => {
    const want = { from: Date.parse("2026-11-06T06:30:00Z"), to: Date.parse("2026-11-09T06:30:00Z") };
    for (const t of ["2026-11-06T18:29:00Z", "2026-11-07T00:00:00Z", "2026-11-08T23:00:00Z", "2026-11-09T06:00:00Z"]) {
      expect(weekendWindow(new Date(t))).toEqual(want);
    }
    expect(weekendWindow(new Date("2026-11-05T12:00:00Z"))).toBeNull(); // Thursday
  });
  it("needs the chosen price to exist", () => {
    expect(() => priceFor({ ...l, hourlyPaise: null }, "hourly", s, new Date(s.getTime() + 3_600_000))).toThrow();
  });
});

describe("computeTrustScore (blueprint §4)", () => {
  it("new user = prior 4.0", () => {
    expect(computeTrustScore({ ratingsCount: 0, starsSum: 0, disputesLost12mo: 0, overdue12mo: 0, completed: 0 })).toBe(4);
  });
  it("applies stars, penalties and the completion bonus, clamped to [0,5]", () => {
    // (20 + 25)/(5+5) = 4.5, -0.5, -0.2, +0.1*5/20 = 0.025 -> 3.825
    expect(computeTrustScore({ ratingsCount: 5, starsSum: 25, disputesLost12mo: 1, overdue12mo: 1, completed: 5 })).toBe(3.83);
    expect(computeTrustScore({ ratingsCount: 1, starsSum: 1, disputesLost12mo: 10, overdue12mo: 0, completed: 0 })).toBe(0);
    expect(computeTrustScore({ ratingsCount: 100, starsSum: 500, disputesLost12mo: 0, overdue12mo: 0, completed: 50 })).toBe(5);
  });
});
