import { Writable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { canSend } from "../src/chat/rules.js";
import { deletionBlockers, type BookingForDeletion } from "../src/lib/deletionRules.js";
import { loggerOptions, redactUrl } from "../src/lib/logRedact.js";

// Pure parts of the Google Play policy fixes. The SQL-heavy parts (deletion
// transaction, blocks, reports, browse filter) are in playPolicy.db.test.ts.

describe("request-log redaction", () => {
  it("keeps the path, drops the whole query string", () => {
    expect(redactUrl("/listings?q=baby%20monitor&kind=item")).toBe("/listings?[redacted]");
    expect(redactUrl("/storage/url?key=proofs/abc.jpg")).toBe("/storage/url?[redacted]");
    expect(redactUrl("/listings/123")).toBe("/listings/123");
    expect(redactUrl(undefined)).toBeUndefined();
  });

  it("Fastify's request log line never contains the search term", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const app = Fastify({ logger: { ...loggerOptions, stream } });
    app.get("/listings", async () => []);
    await app.inject({ method: "GET", url: "/listings?q=pregnancy%20test&societyId=x" });
    await app.close();
    const log = lines.join("");
    expect(log).toContain('"url":"/listings?[redacted]"');
    expect(log).not.toContain("pregnancy");
    expect(log).not.toContain("societyId");
  });
});

describe("account deletion blockers", () => {
  const ME = "me";
  const row = (p: Partial<BookingForDeletion>): BookingForDeletion => ({
    bookingId: "b",
    state: "COMPLETED",
    listingTitle: "Drill",
    awardStatus: null,
    awardPayerId: null,
    awardPayeeId: null,
    refundDuePaise: 0,
    refundConfirmedAt: null,
    ...p,
  });

  it("live states, disputes, unpaid awards (payer or payee) and owed refunds block", () => {
    for (const s of ["REQUESTED", "ACCEPTED", "DEPOSIT_HELD", "HANDOVER_PENDING", "ACTIVE", "OVERDUE", "RETURN_PENDING"]) {
      expect(deletionBlockers([row({ state: s })], ME)[0]?.kind).toBe("live_booking");
    }
    expect(deletionBlockers([row({ state: "DISPUTED" })], ME)[0]?.kind).toBe("open_dispute");
    for (const st of ["debt_recorded", "paid_claimed"]) {
      expect(deletionBlockers([row({ state: "RESOLVED", awardStatus: st, awardPayerId: ME })], ME)[0]?.kind).toBe("unpaid_award");
      expect(deletionBlockers([row({ state: "RESOLVED", awardStatus: st, awardPayeeId: ME })], ME)[0]?.kind).toBe("unpaid_award");
    }
    for (const s of ["COMPLETED", "CANCELLED", "RESOLVED"]) {
      expect(deletionBlockers([row({ state: s, refundDuePaise: 500 })], ME)[0]?.kind).toBe("refund_owed");
    }
  });

  it("finished, settled or refunded bookings don't block", () => {
    expect(
      deletionBlockers(
        [
          row({ state: "COMPLETED" }),
          row({ state: "RESOLVED", awardStatus: "paid", awardPayerId: ME }),
          row({ state: "RESOLVED", awardStatus: "settled_from_deposit", awardPayerId: ME }),
          row({ state: "CANCELLED", refundDuePaise: 500, refundConfirmedAt: new Date() }),
          row({ state: "DECLINED" }),
          row({ state: "EXPIRED" }),
        ],
        ME,
      ),
    ).toEqual([]);
  });
});

describe("canSend with blocks and removed listings", () => {
  const base = { role: "borrower" as const, listingStatus: "active", senderApprovedMember: true, bookings: [], now: Date.now() };
  it("a block closes the chat even with a live booking", () => {
    const live = [{ id: "b", state: "ACTIVE" as const, stateChangedAt: new Date(), createdAt: new Date() }];
    expect(canSend({ ...base, bookings: live })).toBe(true);
    expect(canSend({ ...base, bookings: live, blocked: true })).toBe(false);
  });
  it("a removed listing is closed like an archived one", () => {
    expect(canSend({ ...base, listingStatus: "removed" })).toBe(false);
    expect(canSend({ ...base, listingStatus: "archived" })).toBe(false);
    expect(canSend({ ...base, listingStatus: "paused" })).toBe(true);
  });
});
