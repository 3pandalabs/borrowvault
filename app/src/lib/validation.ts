// Same regex as PATCH /me in ROUTES.md.
export const UPI_VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

export function isValidVpa(v: string): boolean {
  return UPI_VPA_RE.test(v.trim());
}

/** Indian mobile: optional +91/0 prefix, then 10 digits starting 6-9 → "+91XXXXXXXXXX". */
export function normalisePhone(v: string): string | null {
  const digits = v.replace(/[\s-]/g, "").replace(/^(\+91|0091|0)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** UTR / UPI reference: 12 digits is standard; allow 10-22 alphanumerics. */
export function isValidUtr(v: string): boolean {
  return /^[A-Za-z0-9]{10,22}$/.test(v.trim());
}
