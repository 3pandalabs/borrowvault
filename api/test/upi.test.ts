import { describe, expect, it } from "vitest";
import { buildUpiIntent, paiseToRupees, upiNote, UPI_VPA_RE } from "../src/lib/upi.js";
import { depositProvider } from "../src/payments/provider.js";

const bookingId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

describe("paiseToRupees", () => {
  it("formats integer paise with exactly 2 decimals", () => {
    expect(paiseToRupees(35000)).toBe("350.00");
    expect(paiseToRupees(35050)).toBe("350.50");
    expect(paiseToRupees(35005)).toBe("350.05");
    expect(paiseToRupees(1)).toBe("0.01");
    expect(paiseToRupees(0)).toBe("0.00");
    expect(paiseToRupees(123456789)).toBe("1234567.89");
  });
  it("rejects non-integers and negatives", () => {
    expect(() => paiseToRupees(10.5)).toThrow();
    expect(() => paiseToRupees(-1)).toThrow();
  });
});

describe("buildUpiIntent", () => {
  it("builds the exact ROUTES.md format", () => {
    const url = buildUpiIntent({ vpa: "anil.s@okhdfc", name: "Anil S", amountPaise: 35000, bookingId, purpose: "rental fee" });
    expect(url).toBe("upi://pay?pa=anil.s@okhdfc&pn=Anil%20S&am=350.00&cu=INR&tn=BV-1a2b3c4d%20rental%20fee");
  });

  it("url-encodes pn and tn (special characters, non-ASCII)", () => {
    const url = buildUpiIntent({ vpa: "a_b-c@ybl", name: "Rāj & Co=1", amountPaise: 5, bookingId, purpose: "deposit refund" });
    expect(url).toContain("pn=R%C4%81j%20%26%20Co%3D1&");
    expect(url).toContain("am=0.05&");
    expect(url).toMatch(/&tn=BV-1a2b3c4d%20deposit%20refund$/);
    const parsed = new URL(url.replace("upi://", "http://x/"));
    expect(parsed.searchParams.get("pn")).toBe("Rāj & Co=1");
    expect(parsed.searchParams.get("tn")).toBe("BV-1a2b3c4d deposit refund");
    expect(parsed.searchParams.get("cu")).toBe("INR");
  });

  it("uses the first 8 characters of the booking id in the note", () => {
    expect(upiNote(bookingId, "deposit")).toBe("BV-1a2b3c4d deposit");
  });

  it("refuses an invalid VPA", () => {
    expect(() => buildUpiIntent({ vpa: "not-a-vpa", name: "x", amountPaise: 100, bookingId, purpose: "deposit" })).toThrow();
  });
});

describe("UPI VPA validation", () => {
  it("accepts typical VPAs and rejects junk", () => {
    for (const ok of ["anil@okhdfc", "a.b_c-d@ybl", "9876543210@paytm"]) expect(UPI_VPA_RE.test(ok)).toBe(true);
    for (const bad of ["a@b", "@okhdfc", "anil@", "anil@ok1", "an il@ybl", "x@y.z"]) expect(UPI_VPA_RE.test(bad)).toBe(false);
  });
});

describe("DepositProvider (Phase 1 UPI links)", () => {
  const lender = { id: "l", displayName: "Lender L", upiVpa: "lender@okicici" };

  it("declared: fee link only, no deposit link", () => {
    const p = depositProvider("declared").paymentIntents({ bookingId, lender, feePaise: 25000, depositPaise: 300000 });
    expect(p.feeUpiIntent).toContain("am=250.00");
    expect(p.depositUpiIntent).toBeNull();
  });

  it("p2p: separate deposit link to the lender", () => {
    const p = depositProvider("p2p").paymentIntents({ bookingId, lender, feePaise: 25000, depositPaise: 300000 });
    expect(p.depositUpiIntent).toBe("upi://pay?pa=lender@okicici&pn=Lender%20L&am=3000.00&cu=INR&tn=BV-1a2b3c4d%20deposit");
  });

  it("p2p lender-won dispute: award kept from the deposit, remainder refunded", () => {
    const r = depositProvider("p2p").onResolved({ depositPaise: 300000, awardPaise: 25000, raiser: "lender", raisedBySystem: false });
    expect(r).toMatchObject({ refundDuePaise: 275000, awardPaise: 25000, awardFromDepositPaise: 25000, awardStatus: "settled_from_deposit", awardPayer: "borrower" });
  });

  it("p2p award above the deposit: deposit kept in full, excess becomes a debt", () => {
    const r = depositProvider("p2p").onResolved({ depositPaise: 100000, awardPaise: 250000, raiser: "lender", raisedBySystem: false });
    expect(r).toMatchObject({ refundDuePaise: 0, awardPaise: 250000, awardFromDepositPaise: 100000, awardStatus: "debt_recorded", depositStatus: "released" });
  });

  it("declared lender-won dispute: award becomes a recorded debt", () => {
    const r = depositProvider("declared").onResolved({ depositPaise: 300000, awardPaise: 25000, raiser: "lender", raisedBySystem: false });
    expect(r).toMatchObject({ refundDuePaise: 0, awardStatus: "debt_recorded", awardPayer: "borrower", awardPaise: 25000 });
  });

  it("claim cap = max(deposit, replacement value); borrowers may also claim back fee + deposit", () => {
    for (const m of ["p2p", "declared"] as const) {
      const p = depositProvider(m);
      expect(p.claimCap({ raiser: "lender", feePaise: 100, depositPaise: 5000, replacementValuePaise: 90000 })).toBe(90000);
      expect(p.claimCap({ raiser: "lender", feePaise: 100, depositPaise: 0, replacementValuePaise: null })).toBe(0);
      expect(p.claimCap({ raiser: "borrower", feePaise: 50000, depositPaise: 0, replacementValuePaise: null })).toBe(50000);
    }
  });
});
