import { describe, expect, it } from "vitest";
import { computeNextAction, type NextActionInput } from "../src/booking/nextAction.js";
import { HOUR_MS, overdueAt, overdueCountsAgainstTrust } from "../src/booking/states.js";
import { computeTrustScore } from "../src/booking/trust.js";
import { keyedLimiter, selectClientKey } from "../src/lib/clientKey.js";
import { netRefundDue, refundDueOnCancel } from "../src/payments/provider.js";

describe("overdue clock = max(endsAt, activatedAt + 1 h)", () => {
  const endsAt = Date.parse("2026-11-02T10:00:00Z");
  it("on-time handover: overdue at endsAt, counts against trust", () => {
    const activated = endsAt - 24 * HOUR_MS;
    expect(overdueAt(endsAt, activated)).toBe(endsAt);
    expect(overdueCountsAgainstTrust(endsAt, activated)).toBe(true);
  });
  it("late handover (within the last hour, or after endsAt): extended, no trust penalty", () => {
    expect(overdueAt(endsAt, endsAt - 30 * 60_000)).toBe(endsAt + 30 * 60_000);
    expect(overdueAt(endsAt, endsAt + 2 * HOUR_MS)).toBe(endsAt + 3 * HOUR_MS);
    expect(overdueCountsAgainstTrust(endsAt, endsAt - 30 * 60_000)).toBe(false);
    expect(overdueCountsAgainstTrust(endsAt, endsAt + 2 * HOUR_MS)).toBe(false);
  });
  it("exactly 1 h before endsAt is still on time", () => {
    expect(overdueAt(endsAt, endsAt - HOUR_MS)).toBe(endsAt);
    expect(overdueCountsAgainstTrust(endsAt, endsAt - HOUR_MS)).toBe(true);
  });
  it("unknown activation falls back to endsAt", () => {
    expect(overdueAt(endsAt, null)).toBe(endsAt);
  });
});

describe("refund due on cancel", () => {
  it("nothing owed if the lender never confirmed payment", () => {
    expect(refundDueOnCancel({ depositMode: "p2p", feePaise: 30000, depositPaise: 300000, paymentConfirmed: false })).toEqual({
      refundDuePaise: 0,
      depositStatus: "none",
    });
  });
  it("p2p: fee + deposit", () => {
    expect(refundDueOnCancel({ depositMode: "p2p", feePaise: 30000, depositPaise: 300000, paymentConfirmed: true })).toEqual({
      refundDuePaise: 330000,
      depositStatus: "held_by_lender",
    });
  });
  it("declared: fee only (the deposit never moved)", () => {
    expect(refundDueOnCancel({ depositMode: "declared", feePaise: 30000, depositPaise: 300000, paymentConfirmed: true })).toEqual({
      refundDuePaise: 30000,
      depositStatus: "released",
    });
  });
  it("a ruling nets out a refund already confirmed", () => {
    expect(netRefundDue(330000, 0)).toBe(330000);
    expect(netRefundDue(330000, 330000)).toBe(0);
    expect(netRefundDue(100000, 330000)).toBe(0);
    expect(netRefundDue(330000, 30000)).toBe(300000);
  });
});

describe("nextAction on a CANCELLED booking with a refund owed", () => {
  const t0 = new Date("2026-11-01T10:00:00Z");
  const base: NextActionInput = {
    state: "CANCELLED",
    role: "lender",
    stateChangedAt: t0,
    startsAt: t0,
    endsAt: t0,
    inspections: [],
    dispute: null,
    payment: {
      depositMode: "declared",
      claimedAt: t0,
      refundDuePaise: 30000,
      refundClaimedAt: null,
      refundConfirmedAt: null,
      awardStatus: "none",
      awardPayerRole: null,
    },
    ratedByMe: false,
  };
  it("lender refund_deposit with a 24 h deadline; borrower waits, then confirm_refund", () => {
    const l = computeNextAction(base);
    expect(l.nextAction).toBe("refund_deposit");
    expect(l.deadlineAt?.toISOString()).toBe("2026-11-02T10:00:00.000Z");
    expect(computeNextAction({ ...base, role: "borrower" }).nextAction).toBeNull();
    const claimed = { ...base, role: "borrower" as const, payment: { ...base.payment!, refundClaimedAt: t0 } };
    expect(computeNextAction(claimed).nextAction).toBe("confirm_refund");
  });
  it("no refund owed / confirmed: nothing to do, no rating on a cancelled booking", () => {
    const none = { ...base, payment: { ...base.payment!, refundDuePaise: 0 } };
    expect(computeNextAction(none)).toEqual({ nextAction: null, deadlineAt: null });
    const done = { ...base, role: "borrower" as const, payment: { ...base.payment!, refundClaimedAt: t0, refundConfirmedAt: t0 } };
    expect(computeNextAction(done)).toEqual({ nextAction: null, deadlineAt: null });
    expect(computeNextAction({ ...base, payment: null })).toEqual({ nextAction: null, deadlineAt: null });
  });
  it("ACTIVE deadline uses the overdue clock (late handover gets an hour)", () => {
    const endsAt = new Date("2026-11-01T12:00:00Z");
    const activated = new Date("2026-11-01T11:30:00Z");
    const r = computeNextAction({ ...base, state: "ACTIVE", role: "borrower", stateChangedAt: activated, endsAt, payment: null });
    expect(r.deadlineAt?.toISOString()).toBe("2026-11-01T12:30:00.000Z");
  });
});

describe("rate-limit key selection", () => {
  const secret = "s3cret-shared-with-web-worker";
  it("trusts X-Client-IP only with the matching internal secret", () => {
    expect(
      selectClientKey({ headers: { "x-internal-secret": secret, "x-client-ip": "203.0.113.9" }, ip: "10.0.0.1" }, secret),
    ).toBe("203.0.113.9");
  });
  it("ignores X-Client-IP without the secret, or with a wrong one", () => {
    expect(selectClientKey({ headers: { "x-client-ip": "1.2.3.4" }, ip: "10.0.0.1" }, secret)).toBe("10.0.0.1");
    expect(selectClientKey({ headers: { "x-internal-secret": "nope", "x-client-ip": "1.2.3.4" }, ip: "10.0.0.1" }, secret)).toBe(
      "10.0.0.1",
    );
  });
  it("never trusts X-Client-IP when no secret is configured", () => {
    expect(selectClientKey({ headers: { "x-internal-secret": "", "x-client-ip": "1.2.3.4" }, ip: "10.0.0.1" }, "")).toBe("10.0.0.1");
  });
  it("prefers CF-Connecting-IP over req.ip", () => {
    expect(selectClientKey({ headers: { "cf-connecting-ip": "198.51.100.7", "x-client-ip": "1.2.3.4" }, ip: "10.0.0.1" }, secret)).toBe(
      "198.51.100.7",
    );
  });
  it("keyedLimiter: per-key fixed window", () => {
    let t = 0;
    const allow = keyedLimiter(2, 1000, () => t);
    expect([allow("a"), allow("a"), allow("a"), allow("b")]).toEqual([true, true, false, true]);
    t = 1000;
    expect(allow("a")).toBe(true);
  });
});

describe("trust: lender no-show strikes", () => {
  it("costs 0.3 per no-show in 12 months", () => {
    const base = { ratingsCount: 0, starsSum: 0, disputesLost12mo: 0, overdue12mo: 0, completed: 0 };
    expect(computeTrustScore(base)).toBe(4);
    expect(computeTrustScore({ ...base, noShows12mo: 2 })).toBe(3.4);
  });
});
