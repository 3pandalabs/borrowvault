// Builds the Play Store graphics into ../graphics/:
//   icon-512.png             512x512 hi-res icon, from app/assets/source/icon.svg
//   feature-graphic.svg/.png 1024x500 feature graphic (text already converted to paths)
// Run: cd infra/play-store/tools && npm install && npm run graphics
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { measure, textPath } from "./text.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const OUT = here("../graphics/");
const ICON_SVG = readFileSync(here("../../../app/assets/source/icon.svg"), "utf8");

const BRAND = ["#FF9F1C", "#FF3D8B", "#9B5CF6", "#3B82F6", "#10D9A0"];

function render(svg, width, file) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } })
    .render()
    .asPng();
  writeFileSync(OUT + file, png);
  console.log(`wrote graphics/${file}`);
}

// 1. Hi-res icon. Play wants 512x512 32-bit PNG, full square (Play applies its own mask).
render(ICON_SVG, 512, "icon-512.png");

// 2. Feature graphic.
// The icon's inner markup, with ids prefixed so they can't clash with ours.
const iconInner = ICON_SVG.replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replace(/id="([^"]+)"/g, 'id="icon-$1"')
  .replace(/url\(#([^)]+)\)/g, "url(#icon-$1)");

const W = 1024;
const H = 500;
const tile = { x: 92, y: 100, size: 300, r: 68 };
const textX = 446;
const maxText = W - textX - 56;

function fit(text, weight, size) {
  while (measure(text, { size, weight }) > maxText) size -= 1;
  return size;
}
const word = { text: "BorrowVault", weight: 700, size: fit("BorrowVault", 700, 92) };
const tag = { text: "Borrow from your neighbours", weight: 500, size: fit("Borrow from your neighbours", 500, 40) };
const sub = { text: "Verified residents · UPI payments · Photo-checked handovers", weight: 400, size: fit("Verified residents · UPI payments · Photo-checked handovers", 400, 22) };

const stops = BRAND.map((c, i) => `<stop offset="${i / (BRAND.length - 1)}" stop-color="${c}"/>`).join("");

const feature = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#232833"/><stop offset="1" stop-color="#161A22"/></linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#9B5CF6" stop-opacity="0.35"/><stop offset="1" stop-color="#9B5CF6" stop-opacity="0"/></radialGradient>
    <clipPath id="tile"><rect x="${tile.x}" y="${tile.y}" width="${tile.size}" height="${tile.size}" rx="${tile.r}"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="${tile.x + tile.size / 2}" cy="${tile.y + tile.size / 2}" r="300" fill="url(#glow)"/>
  <rect x="0" y="${H - 6}" width="${W}" height="6" fill="url(#brand)"/>
  <g clip-path="url(#tile)">
    <g transform="translate(${tile.x} ${tile.y}) scale(${tile.size / 1024})">${iconInner}</g>
  </g>
  <rect x="${tile.x + 0.5}" y="${tile.y + 0.5}" width="${tile.size - 1}" height="${tile.size - 1}" rx="${tile.r}" fill="none" stroke="#FFFFFF" stroke-opacity="0.10"/>
  <path fill="#FFFFFF" d="${textPath(word.text, { x: textX, y: 232, size: word.size, weight: word.weight })}"/>
  <rect x="${textX + 2}" y="262" width="132" height="8" rx="4" fill="url(#brand)"/>
  <path fill="#E6E8EE" d="${textPath(tag.text, { x: textX, y: 336, size: tag.size, weight: tag.weight })}"/>
  <path fill="#9AA3B2" d="${textPath(sub.text, { x: textX, y: 382, size: sub.size, weight: sub.weight })}"/>
</svg>
`;
writeFileSync(OUT + "feature-graphic.svg", feature);
console.log("wrote graphics/feature-graphic.svg");
render(feature, W, "feature-graphic.png");
