// Turns text into SVG <path> data with opentype.js, so resvg never needs a
// system font. The font is Geist (SIL Open Font License 1.1), the same family
// the website uses, loaded from the `geist` npm package.
import opentype from "opentype.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// `geist` doesn't export its font files, so read them from node_modules directly.
const geistDir = fileURLToPath(new URL("./node_modules/geist/dist/fonts/geist-sans/", import.meta.url));
const cache = new Map();

function font(weight) {
  const file = { 400: "Geist-Regular.ttf", 500: "Geist-Medium.ttf", 600: "Geist-SemiBold.ttf", 700: "Geist-Bold.ttf" }[weight];
  if (!file) throw new Error(`no Geist file for weight ${weight}`);
  if (!cache.has(file)) cache.set(file, opentype.parse(new Uint8Array(readFileSync(join(geistDir, file))).buffer));
  return cache.get(file);
}

/** Width in px of `text` at `size`. */
export function measure(text, { size, weight = 400, letterSpacing = 0 }) {
  const f = font(weight);
  return f.getAdvanceWidth(text, size) + letterSpacing * (text.length - 1);
}

/**
 * SVG path data for `text`, baseline at (x, y). `anchor` is "start" | "middle" | "end".
 */
export function textPath(text, { x, y, size, weight = 400, anchor = "start", letterSpacing = 0 }) {
  const f = font(weight);
  const w = measure(text, { size, weight, letterSpacing });
  let cx = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  let d = "";
  if (!letterSpacing) d = f.getPath(text, cx, y, size).toPathData(2);
  else {
    for (const ch of text) {
      d += f.getPath(ch, cx, y, size).toPathData(2);
      cx += f.getAdvanceWidth(ch, size) + letterSpacing;
    }
  }
  // opentype.js 2.0.0 emits NaN for some Geist glyphs, which silently truncates the
  // path in resvg. Stay on 1.3.x, and fail loudly if it ever happens again.
  if (/NaN|Infinity/.test(d)) throw new Error(`bad path data for "${text}"`);
  return d;
}

/** Greedy word wrap to `maxWidth`. */
export function wrap(text, maxWidth, opts) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, opts) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
