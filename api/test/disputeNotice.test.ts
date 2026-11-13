import { describe, expect, it } from "vitest";
import { istTime, offerAcceptedNotice, responseNotice, rupees } from "../src/booking/disputeNoticeText.js";

const url = "https://borrowvault.3pandalabs.com/bookings/11111111-2222-3333-4444-555555555555";
const base = {
  responderName: "Priya",
  itemTitle: "Bosch drill",
  claimedPaise: 250_000,
  responseText: "The bit was already <chipped> & worn.",
  pilot: false,
  escalatesAt: new Date("2026-11-16T10:00:00Z"),
  url,
};

describe("dispute notice copy", () => {
  it("formats rupees with Indian grouping", () => {
    expect(rupees(150_000)).toBe("₹1,500");
    expect(rupees(15_000_050)).toBe("₹1,50,000.50");
    expect(istTime(new Date("2026-11-16T10:00:00Z"))).toMatch(/16 Nov.*3:30.*pm IST/i);
  });

  it("offer: push + email name the offer, show claim vs offer, the note, what to do, and link in both parts", () => {
    const n = responseNotice({ ...base, offerPaise: 100_000 });
    expect(n.push.title).toBe("Priya offered ₹1,000 to settle the dispute on Bosch drill");
    expect(n.mail.subject).toBe("Priya offered ₹1,000 to settle your dispute");
    for (const part of [n.mail.text, n.mail.html]) {
      expect(part).toContain("₹2,500");
      expect(part).toContain("₹1,000");
      expect(part).toContain("Bosch drill");
      expect(part).toContain(url);
      expect(part).toMatch(/accept the offer/i);
      expect(part).toContain("BorrowVault team");
    }
    expect(n.mail.text).toContain("<chipped> & worn");
    expect(n.mail.html).toContain("&lt;chipped&gt; &amp; worn");
    expect(n.mail.html).not.toContain("<chipped>");
    expect(n.mail.html).toContain(`href="${url}"`);
  });

  it("no offer: says they responded", () => {
    const n = responseNotice({ ...base, offerPaise: null });
    expect(n.push.title).toBe("Priya responded to your dispute");
    expect(n.mail.subject).toBe("Priya responded to your dispute");
    expect(n.mail.html).toContain(`href="${url}"`);
    expect(n.mail.text).not.toMatch(/offered/);
  });

  it("pilot / escalated wording", () => {
    expect(responseNotice({ ...base, offerPaise: 1, pilot: true }).mail.text).toContain("the BorrowVault team will compare");
    expect(responseNotice({ ...base, offerPaise: 1, escalatesAt: null }).mail.text).toContain("already gone to the BorrowVault team");
  });

  it("accepted: to the responder", () => {
    const n = offerAcceptedNotice({ raiserName: "Rahul", itemTitle: "Bosch drill", offerPaise: 100_000, url });
    expect(n.push.title).toBe("Rahul accepted your ₹1,000 offer; dispute settled");
    expect(n.mail.subject).toBe("Rahul accepted your ₹1,000 offer; dispute settled");
    expect(n.mail.html).toContain(`href="${url}"`);
  });
});
