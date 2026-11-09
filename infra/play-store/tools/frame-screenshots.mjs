// Frames raw phone screenshots for the Play listing: a 1080x1920 (9:16) canvas on
// the dark brand background, a caption band on top, the screenshot below with
// rounded corners.
//
// Why: modern phones capture at ~20:9 (e.g. 1080x2400). Play rejects a screenshot
// whose long side is more than twice its short side, so raw captures can fail.
// The framed 9:16 output always passes.
//
// Usage (see ../screenshots.md):
//   1. Put PNG screenshots in ../screenshots/raw/ named 01-browse.png, 02-listing.png, ...
//   2. Put captions in ../screenshots/captions.json: { "01-browse.png": "Borrow from verified neighbours", ... }
//   3. cd infra/play-store/tools && npm install && npm run frame
//   Output: ../screenshots/framed/<same name>.png
import { Resvg } from "@resvg/resvg-js";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { textPath, wrap } from "./text.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const RAW = here("../screenshots/raw/");
const OUT = here("../screenshots/framed/");
const CAPTIONS = here("../screenshots/captions.json");

const W = 1080;
const H = 1920;
const BAND = 400; // caption band height
const PAD = 90;
const BRAND = ["#FF9F1C", "#FF3D8B", "#9B5CF6", "#3B82F6", "#10D9A0"];

function pngSize(buf) {
  if (buf.toString("ascii", 1, 4) !== "PNG") throw new Error("not a PNG");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const captions = existsSync(CAPTIONS) ? JSON.parse(readFileSync(CAPTIONS, "utf8")) : {};
const files = existsSync(RAW) ? readdirSync(RAW).filter((f) => f.toLowerCase().endsWith(".png")).sort() : [];
if (!files.length) {
  console.log("No PNGs in screenshots/raw/. Nothing to do.");
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });

const stops = BRAND.map((c, i) => `<stop offset="${i / (BRAND.length - 1)}" stop-color="${c}"/>`).join("");

for (const file of files) {
  const buf = readFileSync(RAW + file);
  const { w, h } = pngSize(buf);
  const caption = captions[file] ?? file.replace(/^\d+[-_]?/, "").replace(/\.png$/i, "").replace(/[-_]/g, " ");

  const font = { size: 66, weight: 600 };
  const lines = wrap(caption, W - 2 * PAD, font).slice(0, 2);
  const lineH = 84;
  const firstBaseline = BAND / 2 + 24 - ((lines.length - 1) * lineH) / 2;
  const text = lines
    .map((l, i) => `<path fill="#FFFFFF" d="${textPath(l, { x: W / 2, y: firstBaseline + i * lineH, anchor: "middle", ...font })}"/>`)
    .join("");

  const boxW = W - 2 * PAD;
  const boxH = H - BAND - 70;
  const scale = Math.min(boxW / w, boxH / h);
  const sw = Math.round(w * scale);
  const sh = Math.round(h * scale);
  const sx = Math.round((W - sw) / 2);
  const sy = BAND;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#232833"/><stop offset="1" stop-color="#161A22"/></linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient>
    <clipPath id="shot"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="44"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="10" fill="url(#brand)"/>
  ${text}
  <image x="${sx}" y="${sy}" width="${sw}" height="${sh}" clip-path="url(#shot)" preserveAspectRatio="none" xlink:href="data:image/png;base64,${buf.toString("base64")}"/>
  <rect x="${sx + 1}" y="${sy + 1}" width="${sw - 2}" height="${sh - 2}" rx="44" fill="none" stroke="#FFFFFF" stroke-opacity="0.14" stroke-width="2"/>
</svg>`;

  const png = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
  writeFileSync(OUT + file, png);
  console.log(`framed ${file}  (${w}x${h} -> ${W}x${H})  "${lines.join(" / ")}"`);
}
