import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
const [, , src, out, size] = process.argv;
const png = new Resvg(readFileSync(src, "utf8"), { fitTo: { mode: "width", value: Number(size) } }).render().asPng();
writeFileSync(out, png);
