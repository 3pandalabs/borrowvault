// Run with `npm test` (Node ≥22.6 strips the TS types in the imported modules).
// Proves the app's SHA-256 path (bytes → injected digest → hex) yields exactly
// what Node's crypto (and therefore the server's re-hash) produces.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomBytes, webcrypto } from "node:crypto";
import { test } from "node:test";
import { base64ToBytes, sha256Hex, toHex } from "../hash.ts";
import { formatCountdown, formatDateTime, formatPaise, fromIst, rupeesToPaise } from "../format.ts";
import { isValidVpa } from "../validation.ts";

// Same signature as expo-crypto's `digest(SHA256, data) → Promise<ArrayBuffer>`.
const digest = (data) => webcrypto.subtle.digest("SHA-256", data);
const nodeSha = (buf) => createHash("sha256").update(buf).digest("hex");

test("sha256Hex matches Node for empty, known and random (1 MB, JPEG-like) inputs", async () => {
  assert.equal(await sha256Hex(new Uint8Array(), digest), nodeSha(Buffer.alloc(0)));
  assert.equal(
    await sha256Hex(new TextEncoder().encode("abc"), digest),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  const jpegish = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(1024 * 1024)]);
  assert.equal(await sha256Hex(new Uint8Array(jpegish), digest), nodeSha(jpegish));
});

test("base64 → bytes → sha256 matches Node (the read-as-base64 path)", async () => {
  for (const len of [0, 1, 2, 3, 4, 5, 1000, 4097]) {
    const buf = randomBytes(len);
    const bytes = base64ToBytes(buf.toString("base64"));
    assert.deepEqual(Buffer.from(bytes), buf, `round-trip len=${len}`);
    assert.equal(await sha256Hex(bytes, digest), nodeSha(buf));
  }
});

test("toHex pads single-digit bytes", () => {
  assert.equal(toHex(new Uint8Array([0, 1, 15, 16, 255])), "00010f10ff");
});

test("₹ formatting uses Indian grouping from paise", () => {
  assert.equal(formatPaise(0), "₹0");
  assert.equal(formatPaise(35000), "₹350");
  assert.equal(formatPaise(300000), "₹3,000");
  assert.equal(formatPaise(12345678), "₹1,23,456.78");
  assert.equal(formatPaise(1000000000), "₹1,00,00,000");
  assert.equal(rupeesToPaise("1,200.5"), 120050);
  assert.equal(rupeesToPaise("abc"), null);
});

test("times render in Asia/Kolkata", () => {
  assert.equal(formatDateTime("2026-11-03T04:30:00Z"), "Tue 3 Nov, 10:00 AM");
  assert.equal(fromIst(2026, 10, 3, 10, 0).toISOString(), "2026-11-03T04:30:00.000Z");
  assert.equal(formatCountdown((23 * 60 + 12) * 60_000), "23h 12m");
});

test("VPA regex matches ROUTES.md", () => {
  assert.ok(isValidVpa("priya.s@okicici"));
  assert.ok(!isValidVpa("priya@ok1cici"));
  assert.ok(!isValidVpa("p@x"));
});
