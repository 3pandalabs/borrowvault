// Pure SHA-256 plumbing with the digest function injected, so the exact same
// code path is unit-tested in Node (WebCrypto) and runs on device (expo-crypto,
// whose `digest(algorithm, BufferSource) → ArrayBuffer` has the same shape).
// No React Native imports here: Node runs this file directly in the tests.

export type DigestFn = (data: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>;

const HEX = "0123456789abcdef";

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  }
  return out;
}

/** Lower-case hex SHA-256 of the raw file bytes (what the server re-hashes). */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>, digest: DigestFn): Promise<string> {
  return toHex(await digest(bytes));
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64 → bytes, for callers that only have a base64 string of the file. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4) + 3);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6) |
      (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.slice(0, o);
}
