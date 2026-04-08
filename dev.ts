import { spawn, execSync, type ChildProcess } from "node:child_process";
import { watch, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const PROFILE = "Default";
const DEBUG_PORT = 9227;
const DEBOUNCE_MS = 400;
const EXTENSION_DIR = resolve(import.meta.dirname, ".output/opera-mv3");
const SRC_DIR = resolve(import.meta.dirname, "src");
const USER_DATA_DEST = resolve(import.meta.dirname, "../Opera Data WXT");
const START_URL = "https://www.youtube.com/feed/subscriptions";

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

function build() {
  return new Promise<boolean>(resolve => {
    const child = spawn("bun", ["run", "wxt", "build", "-b", "opera"], { stdio: "pipe", shell: true });
    let output = "";
    child.stdout.on("data", (data: Buffer) => { output += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { output += data.toString(); });
    child.on("close", code => {
      if (code !== 0) {
        console.error("Build failed:\n" + output.slice(-500));
      } else {
        console.log("Build succeeded");
      }
      resolve(code === 0);
    });
  });
}

function launchBrowser(): ChildProcess {
  const operaBinary = operaBinaryByPlatform[process.platform] ?? "opera";
  const child = spawn(operaBinary, [
    `--user-data-dir=${USER_DATA_DEST}`,
    `--profile-directory=${PROFILE}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
    `--load-extension=${EXTENSION_DIR}`,
    START_URL
  ], { detached: true, stdio: "ignore" });

  child.unref();
  return child;
}

async function waitForBrowser(maxAttempts = 30): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`http://localhost:${DEBUG_PORT}/json/version`);
      if (response.ok) {
        return true;
      }
    } catch {}
    await new Promise<void>(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

let browserProcess: ChildProcess | null = null;

async function sendCdp(websocketUrl: string, method: string, params: Record<string, unknown> = {}) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { websocket.close(); reject(new Error("CDP timeout")); }, 5000);
    const websocket = new WebSocket(websocketUrl);
    websocket.onopen = () => websocket.send(JSON.stringify({ id: 1, method, params }));
    websocket.onmessage = (event) => {
      if (JSON.parse(String(event.data)).id === 1) { clearTimeout(timeout); websocket.close(); resolve(); }
    };
    websocket.onerror = () => { clearTimeout(timeout); reject(new Error("CDP error")); };
  });
}

async function reloadExtension() {
  try {
    const listResponse = await fetch(`http://localhost:${DEBUG_PORT}/json/list`);
    const targets: { url: string; webSocketDebuggerUrl: string; type: string }[] = await listResponse.json();

    const backgroundTarget = targets.find(
      target => (target.type === "service_worker" || target.type === "background_page") && target.url.startsWith("chrome-extension://")
    );

    if (backgroundTarget) {
      await sendCdp(backgroundTarget.webSocketDebuggerUrl, "Runtime.evaluate", {
        expression: "browser.runtime.reload()"
      }).catch(() => {});
    }

    await new Promise<void>(resolve => setTimeout(resolve, 2000));

    const freshList = await fetch(`http://localhost:${DEBUG_PORT}/json/list`);
    const freshTargets: typeof targets = await freshList.json();

    for (const page of freshTargets.filter(target => target.type === "page" && target.url.includes("youtube.com"))) {
      await sendCdp(page.webSocketDebuggerUrl, "Page.reload", {}).catch(() => {});
    }

    console.log("Extension reloaded + pages refreshed");
  } catch (error) {
    console.warn("Reload failed, restarting browser:", String(error));
    killOpera();
    browserProcess = launchBrowser();
  }
}

async function main() {
  killOpera();
  setupProfile();

  console.log("Building extension...");
  if (!await build()) {
    process.exit(1);
  }

  console.log("Launching Opera...");
  browserProcess = launchBrowser();

  console.log("Waiting for Opera to start...");
  if (!await waitForBrowser()) {
    console.error("Opera failed to start");
    process.exit(1);
  }
  console.log("Opera ready on port " + DEBUG_PORT);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isBuilding = false;

  const watcher = watch(SRC_DIR, { recursive: true }, (_event, filename) => {
    if (!filename || isBuilding) {
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      isBuilding = true;
      console.log(`\nFile changed: ${filename}`);
      if (await build()) {
        await reloadExtension();
      }
      isBuilding = false;
    }, DEBOUNCE_MS);
  });

  console.log(`\nWatching ${SRC_DIR} for changes...`);
  console.log("Press Ctrl+C to stop.\n");

  function cleanup() {
    console.log("\nShutting down...");
    watcher.close();
    killOpera();
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main();
