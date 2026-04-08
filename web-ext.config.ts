import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineWebExtConfig } from "wxt";

const PROFILE = "Default";
const DEBUG_PORT = 9227;

const operaBinaryByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  win32: join(process.env.LOCALAPPDATA!, "Programs", "Opera", "opera.exe"),
  darwin: "/Applications/Opera.app/Contents/MacOS/Opera",
  linux: "/usr/bin/opera"
};

function operaProfileSrc() {
  switch (process.platform) {
    case "win32": return join(process.env.APPDATA!, "Opera Software", "Opera Stable");
    case "darwin": return join(process.env.HOME!, "Library/Application Support/com.operasoftware.Opera");
    default: return join(process.env.HOME!, ".config/opera");
  }
}

const USER_DATA_DEST = resolve(import.meta.dirname, "../Opera Data WXT");

function setupProfile() {
  if (existsSync(USER_DATA_DEST)) {
    return;
  }

  const src = operaProfileSrc();
  execSync(
    process.platform === "win32"
      ? `xcopy "${src}" "${USER_DATA_DEST}" /E /I /Q /Y`
      : `cp -r "${src}" "${USER_DATA_DEST}"`,
    { stdio: "ignore" }
  );
}

function killOpera() {
  try {
    if (process.platform === "win32") {
      execSync(
        `powershell -NoProfile -Command "Get-WmiObject Win32_Process -Filter \\"name='opera.exe'\\" | Where-Object { $_.CommandLine -like '*Opera Data WXT*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }"`,
        { stdio: "ignore" }
      );
    } else {
      execSync(`pkill -f "${USER_DATA_DEST}" 2>/dev/null || true`, { stdio: "ignore" });
    }
  } catch {}
}

if (!process.argv.includes("build")) {
  killOpera();
}

setupProfile();

export default defineWebExtConfig({
  binaries: {
    opera: operaBinaryByPlatform[process.platform] ?? ""
  },
  startUrls: ["https://www.youtube.com/feed/subscriptions"],
  keepProfileChanges: true,
  chromiumProfile: USER_DATA_DEST,
  chromiumArgs: [
    `--profile-directory=${PROFILE}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check"
  ]
});
