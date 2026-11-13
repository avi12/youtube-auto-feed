/**
 * Minimal Firefox RDP CLI.
 * Usage: node scripts/firefox-rdp.mjs <port> "<js-expression-or-file>"
 */
import fs from "fs";

import { evalInFirefox } from "./firefox-rdp-lib.mjs";

const PORT = parseInt(process.argv[2] ?? "56517", 10);
const codeArg = process.argv[3] ?? "";
const code = (fs.existsSync(codeArg) ? fs.readFileSync(codeArg, "utf8") : codeArg).trim();
if (!code) {
  console.error("Usage: node scripts/firefox-rdp.mjs <port> <js-expression-or-file>");
  process.exit(1);
}

const result = await evalInFirefox(PORT, code);
console.log(JSON.stringify(result, null, 2));
