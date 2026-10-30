import { describe, expect, it, vi } from "vitest";
import { IllegalTransition, transition, TransitionConflict } from "../src/booking/transition.js";
import { ALLOWED, BOOKING_STATES, isAllowed, OCCUPYING_STATES, type BookingState } from "../src/booking/states.js";
import { bookingState } from "../src/db/schema.js";

/** Minimal stand-in for a Drizzle transaction: records calls, returns `current` as the locked row. */
function fakeTx(current: BookingState | null) {
  const calls = { select: 0, update: 0, insert: 0, inserted: [] as unknown[], set: [] as unknown[] };
  const tx = {
    select: vi.fn(() => {
      calls.select++;
      return {
        from: () => ({
          where: () => ({ for: async () => (current ? [{ state: current }] : []) }),
        }),
      };
    }),
    update: vi.fn(() => {
      calls.update++;
      return {
        set: (v: unknown) => {
          calls.set.push(v);
          return { where: () => ({ returning: async () => [{ id: "b" }] }) };
        },
      };
    }),
    insert: vi.fn(() => {
      calls.insert++;
      return {
        values: async (v: unknown) => {
          calls.inserted.push(v);
        },
      };
    }),
  };
  return { tx: tx as unknown as Parameters<typeof transition>[0], calls };
}

const base = { bookingId: "11111111-2222-3333-4444-555555555555", actorId: null, reason: "test" };

describe("transition()", () => {
  it("rejects moves that are not in the ALLOWED map, before touching the DB", async () => {
    const illegal: [BookingState, BookingState][] = [
      ["REQUESTED", "ACTIVE"],
      ["REQUESTED", "COMPLETED"],
      ["ACCEPTED", "ACTIVE"],
      ["DEPOSIT_HELD", "COMPLETED"],
      ["ACTIVE", "CANCELLED"],
      ["ACTIVE", "COMPLETED"],
      ["RETURN_PENDING", "ACTIVE"],
      ["DISPUTED", "COMPLETED"],
      ["COMPLETED", "ACTIVE"],
      ["RESOLVED", "DISPUTED"],
      ["CANCELLED", "REQUESTED"],
      ["EXPIRED", "ACCEPTED"],
      ["DECLINED", "ACCEPTED"],
    ];
    for (const [from, to] of illegal) {
      const { tx, calls } = fakeTx(from);
      await expect(transition(tx, { ...base, from, to })).rejects.toBeInstanceOf(IllegalTransition);
      expect(calls.select + calls.update + calls.insert).toBe(0);
    }
  });

  it("rejects if ANY of several `from` states can't reach `to`", async () => {
    const { tx } = fakeTx("ACTIVE");
    await expect(transition(tx, { ...base, from: ["ACTIVE", "DEPOSIT_HELD"], to: "RETURN_PENDING" })).rejects.toBeInstanceOf(
      IllegalTransition,
    );
  });

  it("throws TransitionConflict (409) when the row is no longer in the expected state", async () => {
    const { tx, calls } = fakeTx("DECLINED");
    const err = await transition(tx, { ...base, from: "REQUESTED", to: "ACCEPTED" }).catch((e) => e);
    expect(err).toBeInstanceOf(TransitionConflict);
    expect(err.code).toBe("TRANSITION_CONFLICT");
    expect(err.status).toBe(409);
    expect(calls.update).toBe(0);
    expect(calls.insert).toBe(0);
  });

  it("throws TransitionConflict when the booking doesn't exist", async () => {
    const { tx } = fakeTx(null);
    await expect(transition(tx, { ...base, from: "REQUESTED", to: "ACCEPTED" })).rejects.toBeInstanceOf(TransitionConflict);
  });

  it("updates state and appends exactly one booking_events row on a legal move", async () => {
    const { tx, calls } = fakeTx("RETURN_PENDING");
    const s = await transition(tx, { ...base, from: ["RETURN_PENDING"], to: "COMPLETED", data: { x: 1 } });
    expect(s).toBe("COMPLETED");
    expect(calls.update).toBe(1);
    expect(calls.insert).toBe(1);
    expect(calls.set[0]).toMatchObject({ state: "COMPLETED" });
    expect(calls.inserted[0]).toMatchObject({ fromState: "RETURN_PENDING", toState: "COMPLETED", reason: "test", data: { x: 1 } });
  });
});

describe("state machine table", () => {
  it("matches the Postgres enum exactly", () => {
    expect([...bookingState.enumValues]).toEqual([...BOOKING_STATES]);
  });

  it("terminal states have no exits; COMPLETED/CANCELLED only exit to DISPUTED (refund timeout)", () => {
    for (const s of ["RESOLVED", "DECLINED", "EXPIRED"] as const) expect(ALLOWED[s]).toEqual([]);
    expect(ALLOWED.COMPLETED).toEqual(["DISPUTED"]);
    expect(ALLOWED.CANCELLED).toEqual(["DISPUTED"]);
  });

  it("CANCELLED/COMPLETED -> DISPUTED is system-only: a user actor is rejected", async () => {
    for (const from of ["CANCELLED", "COMPLETED"] as const) {
      const user = fakeTx(from);
      await expect(transition(user.tx, { ...base, actorId: "u1", from, to: "DISPUTED" })).rejects.toBeInstanceOf(IllegalTransition);
      expect(user.calls.select).toBe(0);
      const sys = fakeTx(from);
      await expect(transition(sys.tx, { ...base, actorId: null, from, to: "DISPUTED" })).resolves.toBe("DISPUTED");
    }
  });

  it("cancel is only allowed before ACTIVE", () => {
    expect(BOOKING_STATES.filter((s) => isAllowed(s, "CANCELLED"))).toEqual([
      "REQUESTED",
      "ACCEPTED",
      "DEPOSIT_HELD",
      "HANDOVER_PENDING",
    ]);
  });

  it("occupying states (EXCLUDE constraint) are exactly ACCEPTED..RETURN_PENDING", () => {
    expect(OCCUPYING_STATES).toEqual(["ACCEPTED", "DEPOSIT_HELD", "HANDOVER_PENDING", "ACTIVE", "OVERDUE", "RETURN_PENDING"]);
  });
});
