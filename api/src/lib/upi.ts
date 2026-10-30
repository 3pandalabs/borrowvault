// UPI intent links (Phase 1: no gateway). Format fixed by api/ROUTES.md:
//   upi://pay?pa=<vpa>&pn=<urlencoded name>&am=<rupees, 2 decimals>&cu=INR
//            &tn=<urlencoded "BV-<first 8 of booking id> <purpose>">

export const UPI_VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

export type UpiPurpose = "rental fee" | "deposit" | "deposit refund" | "refund" | "dispute award";

/** Integer paise -> "350.00". Integer arithmetic only: no float rounding. */
export function paiseToRupees(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error(`invalid paise amount: ${paise}`);
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

/** "BV-<first 8 chars of the booking id> <purpose>" */
export function upiNote(bookingId: string, purpose: UpiPurpose): string {
  return `BV-${bookingId.slice(0, 8)} ${purpose}`;
}

export function buildUpiIntent(opts: {
  vpa: string;
  name: string;
  amountPaise: number;
  bookingId: string;
  purpose: UpiPurpose;
}): string {
  if (!UPI_VPA_RE.test(opts.vpa)) throw new Error("invalid UPI VPA");
  return (
    `upi://pay?pa=${opts.vpa}` +
    `&pn=${encodeURIComponent(opts.name)}` +
    `&am=${paiseToRupees(opts.amountPaise)}` +
    `&cu=INR` +
    `&tn=${encodeURIComponent(upiNote(opts.bookingId, opts.purpose))}`
  );
}
