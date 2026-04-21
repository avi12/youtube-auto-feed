import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";

const svg = readFileSync("src/public/icon.svg", "utf-8");

for (const size of [16, 32, 48, 96, 128]) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
  const png = resvg.render().asPng();
  writeFileSync(`src/public/icon/${size}.png`, png);
  console.log(`✓ ${size}x${size}`);
}
