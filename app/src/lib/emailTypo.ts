// "Did you mean name@gmail.com?" for common email-domain typos on sign-up
// (gmail.coma, gmial.com, gmail.con, yahoo.co, hotmail.cm, outlook.co ...).
// Non-blocking: the form only offers a tap-to-fix. Pure (no imports), so
// node --test can load it. Keep identical to web/src/lib/emailTypo.ts.

// Popular providers we suggest. Distance is measured against these.
const POPULAR = [
  "gmail.com",
  "yahoo.com",
  "yahoo.co.in",
  "rediffmail.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "live.com",
  "aol.com",
  "protonmail.com",
  "zoho.com",
];

// Real domains that sit close to a popular one: never "correct" these.
const VALID = new Set([
  ...POPULAR,
  "googlemail.com",
  "ymail.com",
  "yahoo.in",
  "yahoo.co.uk",
  "hotmail.co.uk",
  "outlook.in",
  "live.in",
  "msn.com",
  "me.com",
  "mac.com",
  "mail.com",
  "email.com",
  "proton.me",
  "pm.me",
  "zohomail.in",
]);

/** Edit distance with adjacent transpositions ("gmial" → "gmail" is 1). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) d.push([i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

const split = (domain: string) => {
  const dot = domain.indexOf(".");
  return dot < 1 ? null : { name: domain.slice(0, dot), tld: domain.slice(dot + 1) };
};

/**
 * The corrected address when the domain looks like a typo of a popular one,
 * else null (also for known-good domains and anything unparseable).
 */
export function suggestEmail(input: string): string | null {
  const email = input.trim();
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (VALID.has(domain)) return null;

  // 1. The whole domain is close to a popular one. Short domains get one edit,
  // so "aol.co" → "aol.com" but a random 6-letter domain isn't rewritten.
  let best: string | null = null;
  let bestD = Infinity;
  for (const p of POPULAR) {
    const dist = editDistance(domain, p);
    if (dist < bestD) {
      best = p;
      bestD = dist;
    }
  }
  const allowed = domain.length >= 8 ? 2 : 1;
  if (best && bestD <= allowed) return `${local}@${best}`;

  // 2. The provider name is right and only the TLD is off (gmail.cmoo,
  // hotmail.comm.in): same second-level name, TLD within 2 edits.
  const parts = split(domain);
  if (!parts) return null;
  for (const p of POPULAR) {
    const pp = split(p)!;
    if (pp.name === parts.name && editDistance(parts.tld, pp.tld) <= 2) return `${local}@${p}`;
  }
  return null;
}
