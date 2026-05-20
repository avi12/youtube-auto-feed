/**
 * Dev server: production builds (with source maps) + browser with sideloaded extension.
 * On file changes: rebuilds for production and reloads extension + YouTube tabs.
 *
 * Usage:
 *   bun scripts/dev-server.ts           - Chrome
 *   bun scripts/dev-server.ts --firefox - Firefox
 */

import chokidar from "chokidar";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { homedir, platform } from "node:os";
import { resolve, join, dirname } from "node:path";
import webExtRun from "web-ext-run";
import { consoleStream as webExtConsoleStream } from "web-ext-run/util/logger";
import { build } from "wxt";

const IS_FIREFOX = process.argv.includes("--firefox");
const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_DIR = resolve(PROJECT_ROOT, IS_FIREFOX ? ".output/firefox-mv3" : ".output/chrome-mv3");
const USER_PROFILES_DIR = resolve(PROJECT_ROOT, "user-profiles");
const EDGE_PROFILE_DIR = join(USER_PROFILES_DIR, "edge");
const { LANG = "en" } = process.env;
const START_URL = "https://www.youtube.com/feed/subscriptions";
const CDP_PORT = 9232;
const REBUILD_DEBOUNCE_MS = 800;
const WARN_LOG_LEVEL = 40;

// ── Edge profile setup ──────────────────────────────────────────────────────

const EDGE_PROFILE_SENTINEL = join(EDGE_PROFILE_DIR, "Default", ".seeded");

function setupEdgeProfile() {
  if (existsSync(EDGE_PROFILE_SENTINEL)) {
    return;
  }

  const home = homedir();
  const { LOCALAPPDATA = "" } = process.env;
  const sourceUserData: Record<string, string> = {
    win32: join(LOCALAPPDATA, "Microsoft", "Edge", "User Data"),
    darwin: join(home, "Library", "Application Support", "Microsoft Edge"),
    linux: join(home, ".config", "microsoft-edge")
  };
  const source = sourceUserData[platform()];
  if (!source || !existsSync(source)) {
    mkdirSync(EDGE_PROFILE_DIR, { recursive: true });
    return;
  }

  console.log(`Setting up Edge profile from ${source}...`);
  for (const directory of ["Default", "Profile 1"]) {
    const bookmarksPath = join(source, directory, "Bookmarks");
    if (!existsSync(bookmarksPath)) {
      continue;
    }

    const destinationPath = join(EDGE_PROFILE_DIR, directory, "Bookmarks");
    mkdirSync(dirname(destinationPath), { recursive: true });
    cpSync(bookmarksPath, destinationPath);
  }
  console.log("Profile setup complete.");

  writeFileSync(EDGE_PROFILE_SENTINEL, "");
}

// ── Firefox profile setup ───────────────────────────────────────────────────

const FIREFOX_SESSION_FILES = [
  "cookies.sqlite",
  "key4.db",
  "logins.json",
  "cert9.db",
  "permissions.sqlite",
  "places.sqlite",
  "favicons.sqlite"
];

function findDefaultFirefoxProfilePath() {
  const home = homedir();
  const { APPDATA = "" } = process.env;
  const firefoxDataPaths: Record<string, string> = {
    win32: join(APPDATA, "Mozilla", "Firefox"),
    darwin: join(home, "Library", "Application Support", "Firefox"),
    linux: join(home, ".mozilla", "firefox")
  };
  const firefoxDataPath = firefoxDataPaths[platform()];
  const profilesIniPath = firefoxDataPath && join(firefoxDataPath, "profiles.ini");
  if (!profilesIniPath || !existsSync(profilesIniPath)) {
    return null;
  }

  const ini = readFileSync(profilesIniPath, "utf-8");
  const sections = ini.split(/(?=^\[Profile\d)/m);
  const defaultSection = sections.find(section => /^Default=1$/m.test(section));
  const pathMatch = defaultSection?.match(/^Path=(.+)$/m);
  const isRelative = /^IsRelative=1$/m.test(defaultSection ?? "");
  if (!pathMatch) {
    return null;
  }

  const profilePath = pathMatch[1].trim();
  return isRelative ? join(firefoxDataPath, profilePath) : profilePath;
}

const FIREFOX_PROFILE_DIR = join(USER_PROFILES_DIR, "firefox");
const FIREFOX_PROFILE_SENTINEL = join(FIREFOX_PROFILE_DIR, ".seeded");

function setupFirefoxProfile() {
  if (existsSync(FIREFOX_PROFILE_SENTINEL)) {
    return FIREFOX_PROFILE_DIR;
  }

  mkdirSync(FIREFOX_PROFILE_DIR, { recursive: true });

  const source = findDefaultFirefoxProfilePath();
  if (source && existsSync(source)) {
    console.log(`Setting up Firefox profile from ${source}...`);
    for (const file of FIREFOX_SESSION_FILES) {
      const sourcePath = join(source, file);
      if (!existsSync(sourcePath)) {
        continue;
      }

      cpSync(sourcePath, join(FIREFOX_PROFILE_DIR, file));
    }
    console.log("Profile setup complete.");
  }

  writeFileSync(FIREFOX_PROFILE_SENTINEL, "");
  return FIREFOX_PROFILE_DIR;
}

// ── Firefox cleanup ─────────────────────────────────────────────────────────

function killExistingFirefoxInstances() {
  if (platform() !== "win32") {
    return;
  }

  const script = `
$profile = '${FIREFOX_PROFILE_DIR.replace(/'/g, "''")}'
Get-CimInstance Win32_Process -Filter "name='firefox.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
`;
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
    input: script,
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 5000
  });
}

// ── Edge launch ─────────────────────────────────────────────────────────────

function edgeBinaryPath() {
  const { "PROGRAMFILES(X86)": pf86 = "", PROGRAMFILES = "" } = process.env;
  switch (platform()) {
    case "win32": return join(pf86 || PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe");
    case "darwin": return "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
    default: return "/usr/bin/microsoft-edge";
  }
}

function launchEdge() {
  const browserProcess = spawn(edgeBinaryPath(), [
    `--user-data-dir=${EDGE_PROFILE_DIR}`,
    `--load-extension=${OUTPUT_DIR}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--lang=${LANG}`,
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-background-networking",
    "--new-window",
    START_URL
  ], { stdio: ["ignore", "ignore", "pipe"] });
  browserProcess.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  browserProcess.on("error", error => console.error("Failed to launch Edge:", error));
  return browserProcess;
}

function killBrowserTree(browserProcess: ChildProcess) {
  if (browserProcess.exitCode !== null || browserProcess.signalCode !== null) {
    return;
  }

  const { pid } = browserProcess;
  if (pid === undefined) {
    return;
  }

  if (platform() === "win32") {
    spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
  } else {
    browserProcess.kill("SIGTERM");
  }
}

// ── CDP helpers ─────────────────────────────────────────────────────────────

function sendCdpCommand(webSocketUrl: string, method: string, params: Record<string, unknown> = {}) {
  return new Promise<void>(resolve => {
    const websocket = new WebSocket(webSocketUrl);
    websocket.onopen = () => {
      websocket.send(JSON.stringify({ id: 1, method, params }));
    };
    websocket.onmessage = event => {
      const data = JSON.parse(String(event.data));
      if (data.id === 1) {
        websocket.close();
        resolve();
      }
    };
    websocket.onerror = () => resolve();
  });
}

function evaluateCdpExpression(webSocketUrl: string, expression: string) {
  return new Promise<string | null>(resolve => {
    const websocket = new WebSocket(webSocketUrl);
    websocket.onopen = () => {
      websocket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression } }));
    };
    websocket.onmessage = event => {
      const data = JSON.parse(String(event.data));
      if (data.id === 1) {
        websocket.close();
        resolve(data.result?.result?.value ?? null);
      }
    };
    websocket.onerror = () => resolve(null);
    setTimeout(() => { websocket.close(); resolve(null); }, 3000);
  });
}

interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

async function getCdpTargets() {
  const response = await fetch(`http://localhost:${CDP_PORT}/json`);
  return await response.json() as CdpTarget[];
}

async function findOurExtensionTarget() {
  const targets = await getCdpTargets();
  const candidates = targets.filter(
    target => (target.type === "service_worker" || target.type === "background_page") &&
    target.url.startsWith("chrome-extension://") &&
    target.webSocketDebuggerUrl !== undefined
  );

  for (const candidate of candidates) {
    const name = await evaluateCdpExpression(candidate.webSocketDebuggerUrl!, "chrome.runtime.getManifest().name");
    if (name === "YouTube Auto Feed") {
      return candidate;
    }
  }
  return null;
}

async function findExtensionIsolatedContextId(pageWebSocketUrl: string) {
  return new Promise<number | null>(resolve => {
    const websocket = new WebSocket(pageWebSocketUrl);
    let contextId: number | null = null;

    websocket.onmessage = event => {
      const data = JSON.parse(String(event.data));
      if (data.method === "Runtime.executionContextCreated") {
        const context = data.params?.context;
        if (context?.name === "YouTube Auto Feed") {
          contextId = context.id;
        }
        return;
      }
      if (data.id === 1) {
        websocket.close();
        resolve(contextId);
      }
    };

    websocket.onopen = () => {
      websocket.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
    };

    websocket.onerror = () => resolve(null);
    setTimeout(() => { websocket.close(); resolve(null); }, 3000);
  });
}

async function wakeExtensionServiceWorker() {
  const targets = await getCdpTargets();
  const ytPage = targets.find(
    target => target.type === "page" && target.url.includes("youtube.com") && target.webSocketDebuggerUrl
  );
  if (!ytPage?.webSocketDebuggerUrl) {
    return;
  }

  const contextId = await findExtensionIsolatedContextId(ytPage.webSocketDebuggerUrl);
  if (contextId === null) {
    return;
  }

  await new Promise<void>(resolve => {
    const websocket = new WebSocket(ytPage.webSocketDebuggerUrl!);
    websocket.onopen = () => {
      websocket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "chrome.runtime.connect()", contextId } }));
    };
    websocket.onmessage = event => {
      const data = JSON.parse(String(event.data));
      if (data.id === 1) { websocket.close(); resolve(); }
    };
    websocket.onerror = () => resolve();
  });

  await new Promise(resolve => setTimeout(resolve, 800));
}

async function reloadExtension() {
  let target = await findOurExtensionTarget();

  if (!target) {
    await wakeExtensionServiceWorker();
    target = await findOurExtensionTarget();
  }

  if (target?.webSocketDebuggerUrl) {
    await sendCdpCommand(target.webSocketDebuggerUrl, "Runtime.evaluate", { expression: "chrome.runtime.reload()" });
  }
}

async function reloadYouTubeTabs() {
  const targets = await getCdpTargets();

  for (const target of targets) {
    if (target.type !== "page" || !target.url.includes("youtube.com") || !target.webSocketDebuggerUrl) {
      continue;
    }

    await sendCdpCommand(target.webSocketDebuggerUrl, "Page.reload");
  }
}

async function reloadExtensionAndTabs() {
  try {
    await reloadExtension();
    await reloadYouTubeTabs();
  } catch {
    // CDP not available yet
  }
}

async function waitForChromeClose() {
  const cdpUrl = `http://localhost:${CDP_PORT}/json/version`;

  let isStarted = false;
  for (let attempt = 0; attempt < 20 && !isStarted; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      isStarted = (await fetch(cdpUrl)).ok;
    } catch {}
  }

  if (!isStarted) {
    return;
  }

  while (true) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    try {
      if (!(await fetch(cdpUrl)).ok) {
        return;
      }
    } catch {
      return;
    }
  }
}

// ── Build ───────────────────────────────────────────────────────────────────

async function buildExtension() {
  await build({
    root: PROJECT_ROOT,
    browser: IS_FIREFOX ? "firefox" : "chrome",
    manifestVersion: 3,
    vite: () => ({ build: { sourcemap: true } })
  });
}

// ── Debounce ─────────────────────────────────────────────────────────────────

function debounce<T extends unknown[]>(fn: (...args: T) => void | Promise<void>, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: T) => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void fn(...args);
    }, delayMs);
  };
}

// ── Firefox dev loop ────────────────────────────────────────────────────────

async function runFirefox() {
  killExistingFirefoxInstances();
  const profileDirectory = setupFirefoxProfile();

  console.log("Building extension for Firefox (production + source maps)...");
  await buildExtension();
  console.log("Build complete.\n");

  webExtConsoleStream.write = ({ level, msg: message }) => {
    if (level >= WARN_LOG_LEVEL) {
      console.warn(message);
    }
  };

  const runner = await webExtRun.cmd.run({
    target: "firefox-desktop",
    sourceDir: OUTPUT_DIR,
    startUrl: [START_URL],
    keepProfileChanges: true,
    firefoxProfile: profileDirectory,
    args: [`--lang=${LANG}`, "--marionette"],
    noReload: true,
    noInput: true
  }, { shouldExitProgram: false });

  console.log("Firefox launched with extension sideloaded.");
  console.log("Watching for file changes...\n");

  const watcher = chokidar.watch(["src", "wxt.config.ts"], {
    cwd: PROJECT_ROOT.replaceAll("\\", "/"),
    ignoreInitial: true,
    usePolling: true,
    interval: 500
  });

  const onFileChange = debounce(async (_event: string, filePath: string) => {
    console.log(`\nChange detected: ${filePath}`);
    console.log("Rebuilding...");
    try {
      await buildExtension();
      await runner.reloadAllExtensions();
      console.log(`Reloaded at ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.error("Rebuild failed:", error);
    }
  }, REBUILD_DEBOUNCE_MS);

  watcher.on("all", (event, filePath) => onFileChange(event, filePath));

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await watcher.close();
      await runner.exit();
      process.exit(0);
    });
  }

  await new Promise(() => {});
}

// ── Edge dev loop ───────────────────────────────────────────────────────────

async function runEdge() {
  setupEdgeProfile();

  console.log("Building extension for Edge (production + source maps)...");
  await buildExtension();
  console.log("Build complete.\n");

  const browserProcess = launchEdge();
  console.log("Edge launched with extension sideloaded.");
  console.log("Watching for file changes...\n");

  const watcher = chokidar.watch(["src", "wxt.config.ts"], {
    cwd: PROJECT_ROOT.replaceAll("\\", "/"),
    ignoreInitial: true,
    usePolling: true,
    interval: 500
  });

  const onFileChange = debounce(async (_event: string, filePath: string) => {
    console.log(`\nChange detected: ${filePath}`);
    console.log("Rebuilding...");
    try {
      await buildExtension();
      await reloadExtensionAndTabs();
      console.log(`Reloaded at ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.error("Rebuild failed:", error);
    }
  }, REBUILD_DEBOUNCE_MS);

  watcher.on("all", (event, filePath) => onFileChange(event, filePath));

  let isShuttingDown = false;
  const shutdown = () => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    killBrowserTree(browserProcess);
    void watcher.close();
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      shutdown();
      process.exit(0);
    });
  }
  process.on("exit", shutdown);

  await waitForChromeClose();
  if (!isShuttingDown) {
    shutdown();
    process.exit(0);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.chdir(PROJECT_ROOT);

  if (IS_FIREFOX) {
    await runFirefox();
  } else {
    await runEdge();
  }
}

main().catch(error => {
  console.error("Fatal:", error);
  process.exit(1);
});
