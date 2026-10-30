import { describe, expect, it } from "vitest";
import { computeNextAction, type NextActionInput } from "../src/booking/nextAction.js";

const H = 3_600_000;
const t0 = new Date("2026-11-01T10:00:00Z");
const startsAt = new Date(t0.getTime() + 48 * H);
const endsAt = new Date(startsAt.getTime() + 24 * H);

function input(over: Partial<NextActionInput>): NextActionInput {
  return {
    state: "REQUESTED",
    role: "borrower",
    stateChangedAt: t0,
    startsAt,
    endsAt,
    inspections: [],
    dispute: null,
    payment: null,
    ratedByMe: false,
    ...over,
  };
}

const payment = (over: Partial<NonNullable<NextActionInput["payment"]>> = {}): NonNullable<NextActionInput["payment"]> => ({
  depositMode: "declared",
  claimedAt: null,
  refundDuePaise: 0,
  refundClaimedAt: null,
  refundConfirmedAt: null,
  awardStatus: "none",
  awardPayerRole: null,
  ...over,
});

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("computeNextAction", () => {
  it("REQUESTED: lender decides, borrower waits; deadline = +12 h", () => {
    const l = computeNextAction(input({ role: "lender" }));
    expect(l.nextAction).toBe("accept_or_decline");
    expect(iso(l.deadlineAt)).toBe("2026-11-01T22:00:00.000Z");
    expect(computeNextAction(input({ role: "borrower" })).nextAction).toBe("wait_lender");
  });

  it("ACCEPTED: pay -> wait_payment / wait_payment -> confirm_payment; deadline = +2 h", () => {
    expect(computeNextAction(input({ state: "ACCEPTED", payment: payment() })).nextAction).toBe("pay");
    expect(computeNextAction(input({ state: "ACCEPTED", role: "lender", payment: payment() })).nextAction).toBe("wait_payment");
    const claimed = payment({ claimedAt: t0 });
    expect(computeNextAction(input({ state: "ACCEPTED", payment: claimed })).nextAction).toBe("wait_payment");
    const l = computeNextAction(input({ state: "ACCEPTED", role: "lender", payment: claimed }));
    expect(l.nextAction).toBe("confirm_payment");
    expect(iso(l.deadlineAt)).toBe("2026-11-01T12:00:00.000Z");
  });

  it("DEPOSIT_HELD: nothing to do, deadline is when the handover window opens", () => {
    const r = computeNextAction(input({ state: "DEPOSIT_HELD" }));
    expect(r.nextAction).toBeNull();
    expect(iso(r.deadlineAt)).toBe(new Date(startsAt.getTime() - H).toISOString());
  });

  it("HANDOVER_PENDING: inspect, then the borrower acks the lender's inspection", () => {
    const s = { state: "HANDOVER_PENDING" as const };
    expect(computeNextAction(input({ ...s, role: "lender" })).nextAction).toBe("handover_inspect");
    expect(computeNextAction(input({ ...s, role: "borrower" })).nextAction).toBe("handover_inspect");

    const lenderDone = [{ phase: "handover" as const, party: "lender" as const, ackResult: null }];
    expect(computeNextAction(input({ ...s, role: "lender", inspections: lenderDone })).nextAction).toBe("wait_handover");

    const bothDone = [...lenderDone, { phase: "handover" as const, party: "borrower" as const, ackResult: null }];
    const b = computeNextAction(input({ ...s, role: "borrower", inspections: bothDone }));
    expect(b.nextAction).toBe("handover_ack");
    expect(iso(b.deadlineAt)).toBe(new Date(startsAt.getTime() + 24 * H).toISOString());

    const objected = [{ ...lenderDone[0], ackResult: "objected" }, bothDone[1]];
    expect(computeNextAction(input({ ...s, role: "borrower", inspections: objected })).nextAction).toBe("wait_handover");
  });

  it("ACTIVE / OVERDUE: borrower returns", () => {
    const a = computeNextAction(input({ state: "ACTIVE" }));
    expect(a.nextAction).toBe("return_inspect");
    expect(a.deadlineAt?.getTime()).toBe(endsAt.getTime());
    expect(computeNextAction(input({ state: "ACTIVE", role: "lender" })).nextAction).toBeNull();
    expect(computeNextAction(input({ state: "OVERDUE" })).nextAction).toBe("return_inspect");
  });

  it("RETURN_PENDING: lender reviews within 24 h, borrower waits", () => {
    const ret = [{ phase: "return" as const, party: "borrower" as const, ackResult: null }];
    const l = computeNextAction(input({ state: "RETURN_PENDING", role: "lender", inspections: ret }));
    expect(l.nextAction).toBe("review_return");
    expect(iso(l.deadlineAt)).toBe("2026-11-02T10:00:00.000Z");
    expect(computeNextAction(input({ state: "RETURN_PENDING", role: "borrower", inspections: ret })).nextAction).toBe("wait_review");
  });

  it("DISPUTED: respondent responds, then both wait for the ruling; admin gets null", () => {
    const d = { raisedByRole: "lender" as const, responded: false, createdAt: t0, escalated: false, resolved: false };
    const b = computeNextAction(input({ state: "DISPUTED", role: "borrower", dispute: d }));
    expect(b.nextAction).toBe("respond_dispute");
    expect(iso(b.deadlineAt)).toBe("2026-11-04T10:00:00.000Z");
    expect(computeNextAction(input({ state: "DISPUTED", role: "lender", dispute: d })).nextAction).toBe("wait_ruling");
    expect(computeNextAction(input({ state: "DISPUTED", role: "borrower", dispute: { ...d, responded: true } })).nextAction).toBe(
      "wait_ruling",
    );
    expect(computeNextAction(input({ state: "DISPUTED", role: "admin", dispute: d })).nextAction).toBeNull();
    expect(computeNextAction(input({ state: "DISPUTED", role: "lender", dispute: { ...d, escalated: true } })).deadlineAt).toBeNull();
  });

  it("COMPLETED (p2p): refund_deposit -> confirm_refund -> rate, with a 24 h deadline", () => {
    const p = payment({ depositMode: "p2p", refundDuePaise: 300000 });
    const l = computeNextAction(input({ state: "COMPLETED", role: "lender", payment: p }));
    expect(l.nextAction).toBe("refund_deposit");
    expect(iso(l.deadlineAt)).toBe("2026-11-02T10:00:00.000Z");
    expect(computeNextAction(input({ state: "COMPLETED", role: "borrower", payment: p })).nextAction).toBe("rate");
    const claimed = { ...p, refundClaimedAt: t0 };
    expect(computeNextAction(input({ state: "COMPLETED", role: "borrower", payment: claimed })).nextAction).toBe("confirm_refund");
    const done = { ...claimed, refundConfirmedAt: t0 };
    const r = computeNextAction(input({ state: "COMPLETED", role: "borrower", payment: done }));
    expect(r.nextAction).toBe("rate");
    expect(r.deadlineAt).toBeNull();
    expect(computeNextAction(input({ state: "COMPLETED", role: "borrower", payment: done, ratedByMe: true })).nextAction).toBeNull();
  });

  it("RESOLVED (declared): payer pays the award, payee confirms", () => {
    const debt = payment({ awardStatus: "debt_recorded", awardPayerRole: "borrower" });
    expect(computeNextAction(input({ state: "RESOLVED", role: "borrower", payment: debt })).nextAction).toBe("pay_award");
    expect(computeNextAction(input({ state: "RESOLVED", role: "lender", payment: debt })).nextAction).toBe("rate");
    const claimed = { ...debt, awardStatus: "paid_claimed" as const };
    expect(computeNextAction(input({ state: "RESOLVED", role: "lender", payment: claimed })).nextAction).toBe("confirm_award");
  });

  it("dead-end states have no action", () => {
    for (const state of ["DECLINED", "EXPIRED", "CANCELLED"] as const) {
      for (const role of ["lender", "borrower"] as const) {
        expect(computeNextAction(input({ state, role }))).toEqual({ nextAction: null, deadlineAt: null });
      }
    }
  });
});

describe("return review (lender acks, no lender return inspection)", () => {
  it("objected keeps review_return (lender must dispute within 24 h); agreed clears it", () => {
    const base = { phase: "return" as const, party: "borrower" as const };
    const objected = computeNextAction(input({ state: "RETURN_PENDING", role: "lender", inspections: [{ ...base, ackResult: "objected" }] }));
    expect(objected.nextAction).toBe("review_return");
    const agreed = computeNextAction(input({ state: "RETURN_PENDING", role: "lender", inspections: [{ ...base, ackResult: "agreed" }] }));
    expect(agreed.nextAction).toBeNull();
  });
});
