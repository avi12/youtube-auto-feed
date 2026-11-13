/**
 * Minimal Firefox RDP CLI.
 * Usage: node scripts/firefox-rdp.mjs <port> "<js-expression-or-file>"
 */
import fileSystem from "fs";

import { evalInFirefox } from "./firefox-rdp-lib.mjs";

const PORT = parseInt(process.argv[2] ?? "56517", 10);
const codeArg = process.argv[3] ?? "";
const code = (fileSystem.existsSync(codeArg) ? fileSystem.readFileSync(codeArg, "utf8") : codeArg).trim();
if (!code) {
  console.error("Usage: node scripts/firefox-rdp.mjs <port> <js-expression-or-file>");
  process.exit(1);
}

const result = await evalInFirefox({
  port: PORT,
  jsCode: code
});
console.log(JSON.stringify(result, null, 2));
