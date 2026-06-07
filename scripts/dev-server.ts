/**
 * Dev server: production builds (with source maps) + browsers with/without sideloaded extension.
 * On file changes under src/ or wxt.config.ts: rebuilds the needed formats, reloads sideloaded
 * extensions, and reloads YouTube tabs in every launched Chromium browser.
 *
 * Usage examples:
 *   pnpm dev                                              - Edge (sideloaded)            [default]
 *   pnpm exec tsx scripts/dev-server.ts --chrome          - Chrome (sideloaded)
 *   pnpm exec tsx scripts/dev-server.ts --edge --chrome   - Edge + Chrome (both sideloaded)
 *   pnpm dev:edge-chrome-no-extension                     - Edge (sideloaded) + Chrome (no ext)
 *   pnpm exec tsx scripts/dev-server.ts --firefox         - Firefox (sideloaded)
 *   pnpm exec tsx scripts/dev-server.ts --firefox.no-extension - Firefox (no extension)
 */

import chokidar from "chokidar";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { homedir, platform } from "node:os";
import { resolve, join, dirname } from "node:path";
import { format, parseArgs } from "node:util";
import webExtRun from "web-ext-run";
import { consoleStream as webExtConsoleStream } from "web-ext-run/util/logger";
import { build } from "wxt";

// ── Browser specs ───────────────────────────────────────────────────────────

const CHROMIUM_VENDORS = ["edge", "chrome"] as const;
const ALL_VENDORS = [...CHROMIUM_VENDORS, "firefox"] as const;
type ChromiumVendor = typeof CHROMIUM_VENDORS[number];
type Vendor = typeof ALL_VENDORS[number];

interface BrowserSpec {
  vendor: Vendor;
  withExtension: boolean;
}

function isChromiumVendor(vendor: Vendor): vendor is ChromiumVendor {
  return CHROMIUM_VENDORS.some(known => known === vendor);
}

function isChromiumSpec(spec: BrowserSpec): spec is BrowserSpec & { vendor: ChromiumVendor } {
  return isChromiumVendor(spec.vendor);
}

const USAGE = "Usage: dev-server.ts [--edge|--chrome|--firefox][.no-extension]...";

const { values: flags } = parseArgs({
  args: process.argv.slice(2),
  options: {
    edge: {
      type: "boolean",
      default: false
    },
    "edge.no-extension": {
      type: "boolean",
      default: false
    },
    chrome: {
      type: "boolean",
      default: false
    },
    "chrome.no-extension": {
      type: "boolean",
      default: false
    },
    firefox: {
      type: "boolean",
      default: false
    },
    "firefox.no-extension": {
      type: "boolean",
      default: false
    },
    help: {
      type: "boolean",
      short: "h",
      default: false
    }
  }
});
if (flags.help) {
  console.log(USAGE);
  process.exit(0);
}

const browserSpecs: BrowserSpec[] = [];
for (const vendor of ALL_VENDORS) {
  const isPresent = flags[vendor] || flags[`${vendor}.no-extension`];
  if (!isPresent) {
    continue;
  }

  browserSpecs.push({
    vendor,
    withExtension: !flags[`${vendor}.no-extension`]
  });
}

if (browserSpecs.length === 0) {
  browserSpecs.push({
    vendor: "edge",
    withExtension: true
  });
}

// ── Constants ───────────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const LOG_FILE_PATH = resolve(PROJECT_ROOT, "tmp/dev-server.log");
const USER_PROFILES_DIR = resolve(PROJECT_ROOT, "user-profiles");

mkdirSync(dirname(LOG_FILE_PATH), { recursive: true });
const logStream = createWriteStream(LOG_FILE_PATH, { flags: "a" });
logStream.write(`\n========== session start ${new Date().toISOString()} pid=${process.pid} node=${process.version} ==========\n`);

function writeToLog(prefix: string, args: unknown[]) {
  logStream.write(`[${new Date().toISOString()}] [${prefix}] ${format(...args)}\n`);
}

const originalConsoleLog = console.log.bind(console);
const originalConsoleWarn = console.warn.bind(console);
const originalConsoleError = console.error.bind(console);

console.log = (...args: unknown[]) => {
  writeToLog("log", args);
  originalConsoleLog(...args);
};

console.warn = (...args: unknown[]) => {
  writeToLog("warn", args);
  originalConsoleWarn(...args);
};

console.error = (...args: unknown[]) => {
  writeToLog("error", args);
  originalConsoleError(...args);
};

console.log(`Dev server logging to ${LOG_FILE_PATH}`);

const CHROMIUM_OUTPUT_DIR = resolve(PROJECT_ROOT, ".output/chrome-mv3");
const FIREFOX_OUTPUT_DIR = resolve(PROJECT_ROOT, ".output/firefox-mv3");
const FIREFOX_PROFILE_DIR = join(USER_PROFILES_DIR, "firefox");
const { LANG = "en" } = process.env;
const START_URL = "https://www.youtube.com/feed/subscriptions";
const REBUILD_DEBOUNCE_MS = 800;
const WARN_LOG_LEVEL = 40;
const CDP_BOOT_POLL_ATTEMPTS = 20;
const CDP_BOOT_POLL_INTERVAL_MS = 500;
const CDP_COMMAND_TIMEOUT_MS = 5000;

const CHROMIUM_CONFIG: Record<ChromiumVendor, {
  profileDir: string;
  cdpPort: number;
}> = {
  edge: {
    profileDir: join(USER_PROFILES_DIR, "edge"),
    cdpPort: 9232
  },
  chrome: {
    profileDir: join(USER_PROFILES_DIR, "chrome"),
    cdpPort: 9231
  }
};

// ── Chromium profile setup ──────────────────────────────────────────────────

function chromiumSourceUserDataDir(vendor: ChromiumVendor) {
  const home = homedir();
  const { LOCALAPPDATA = "" } = process.env;
  const map: Record<ChromiumVendor, Record<string, string>> = {
    edge: {
      win32: join(LOCALAPPDATA, "Microsoft", "Edge", "User Data"),
      darwin: join(home, "Library", "Application Support", "Microsoft Edge"),
      linux: join(home, ".config", "microsoft-edge")
    },
    chrome: {
      win32: join(LOCALAPPDATA, "Google", "Chrome", "User Data"),
      darwin: join(home, "Library", "Application Support", "Google", "Chrome"),
      linux: join(home, ".config", "google-chrome")
    }
  };
  return map[vendor][platform()];
}

function setupChromiumProfile(profileDirectory: string, vendor: ChromiumVendor) {
  const sentinel = join(profileDirectory, "Default", ".seeded");
  if (existsSync(sentinel)) {
    return;
  }

  const source = chromiumSourceUserDataDir(vendor);
  if (!source || !existsSync(source)) {
    mkdirSync(dirname(sentinel), { recursive: true });
    writeFileSync(sentinel, "");
    return;
  }

  console.log(`Setting up ${vendor} profile from ${source}...`);
  for (const directory of ["Default", "Profile 1"]) {
    const bookmarksPath = join(source, directory, "Bookmarks");
    if (!existsSync(bookmarksPath)) {
      continue;
    }

    const destinationPath = join(profileDirectory, directory, "Bookmarks");
    mkdirSync(dirname(destinationPath), { recursive: true });
    cpSync(bookmarksPath, destinationPath);
  }
  console.log("Profile setup complete.");

  mkdirSync(dirname(sentinel), { recursive: true });
  writeFileSync(sentinel, "");
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

function killProcessesByProfileDir(processName: string, profileDir: string) {
  if (platform() !== "win32") {
    return;
  }

  const script = `
$profile = '${profileDir.replace(/'/g, "''")}'
Get-CimInstance Win32_Process -Filter "name='${processName}'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
`;
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
    input: script,
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 5000
  });
}

function killExistingFirefoxInstances() {
  killProcessesByProfileDir("firefox.exe", FIREFOX_PROFILE_DIR);
}

function sweepRemainingBrowsers() {
  for (const spec of browserSpecs) {
    if (spec.vendor === "firefox") {
      killProcessesByProfileDir("firefox.exe", FIREFOX_PROFILE_DIR);
      continue;
    }

    const { profileDir } = CHROMIUM_CONFIG[spec.vendor];
    const processName = spec.vendor === "edge" ? "msedge.exe" : "chrome.exe";
    killProcessesByProfileDir(processName, profileDir);
  }
}

// ── Binary discovery ────────────────────────────────────────────────────────

function firstExistingPath(candidates: string[]) {
  return candidates.find(existsSync) ?? candidates[0];
}

function edgeBinaryPath() {
  const { "PROGRAMFILES(X86)": pf86 = "", PROGRAMFILES = "" } = process.env;
  switch (platform()) {
    case "win32": return join(pf86 || PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe");
    case "darwin": return "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
    default: return "/usr/bin/microsoft-edge";
  }
}

function chromeBinaryPath() {
  const { "PROGRAMFILES(X86)": pf86 = "", PROGRAMFILES = "", LOCALAPPDATA = "" } = process.env;
  switch (platform()) {
    case "win32": return firstExistingPath([
      join(PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
      join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      join(LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
    ]);
    case "darwin": return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    default: return "/usr/bin/google-chrome";
  }
}

function firefoxBinaryPath() {
  const { "PROGRAMFILES(X86)": pf86 = "", PROGRAMFILES = "" } = process.env;
  switch (platform()) {
    case "win32": return firstExistingPath([
      join(PROGRAMFILES, "Mozilla Firefox", "firefox.exe"),
      join(pf86, "Mozilla Firefox", "firefox.exe")
    ]);
    case "darwin": return "/Applications/Firefox.app/Contents/MacOS/firefox";
    default: return "/usr/bin/firefox";
  }
}

function chromiumBinaryPath(vendor: ChromiumVendor) {
  return vendor === "edge" ? edgeBinaryPath() : chromeBinaryPath();
}

// ── CDP helpers ─────────────────────────────────────────────────────────────

interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

function sendCdpCommand(webSocketUrl: string, method: string, params: Record<string, unknown> = {}) {
  return new Promise<void>(resolvePromise => {
    const websocket = new WebSocket(webSocketUrl);
    let isSettled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function settle() {
      if (isSettled) {
        return;
      }

      isSettled = true;

      if (timer !== null) {
        clearTimeout(timer);
      }

      try {
        websocket.close();
      } catch {}
      resolvePromise();
    }

    timer = setTimeout(settle, CDP_COMMAND_TIMEOUT_MS);
    websocket.onopen = () => {
      websocket.send(
        JSON.stringify({
          id: 1,
          method,
          params
        })
      );
    };
    websocket.onmessage = e => {
      const data = JSON.parse(String(e.data));
      if (data.id === 1) {
        settle();
      }
    };
    websocket.onerror = settle;
    websocket.onclose = settle;
  });
}

async function reloadYouTubeTabsAt(cdpPort: number) {
  try {
    const response = await fetch(`http://localhost:${cdpPort}/json`);
    const targets: CdpTarget[] = await response.json();
    for (const target of targets) {
      if (target.type !== "page" || !target.url.includes("youtube.com") || !target.webSocketDebuggerUrl) {
        continue;
      }

      await sendCdpCommand(target.webSocketDebuggerUrl, "Page.reload");
    }
  } catch {
    // CDP HTTP endpoint not available
  }
}

async function waitForCdpReady(cdpPort: number) {
  const cdpUrl = `http://localhost:${cdpPort}/json/version`;
  for (let attempt = 0; attempt < CDP_BOOT_POLL_ATTEMPTS; attempt++) {
    await new Promise(resolveTimer => setTimeout(resolveTimer, CDP_BOOT_POLL_INTERVAL_MS));
    try {
      if ((await fetch(cdpUrl)).ok) {
        console.log(`CDP ready on port ${cdpPort} after ${attempt + 1} attempts.`);
        return true;
      }
    } catch {}
  }
  console.warn(`CDP NEVER became ready on port ${cdpPort} (${CDP_BOOT_POLL_ATTEMPTS} attempts)`);
  return false;
}

// ── Build ───────────────────────────────────────────────────────────────────

type ExtensionFormat = "chromium" | "firefox";

function neededFormats(specs: BrowserSpec[]): ExtensionFormat[] {
  const formats: ExtensionFormat[] = [];
  if (specs.some(spec => spec.withExtension && isChromiumVendor(spec.vendor))) {
    formats.push("chromium");
  }

  if (specs.some(spec => spec.withExtension && spec.vendor === "firefox")) {
    formats.push("firefox");
  }

  return formats;
}

async function buildExtension(format: ExtensionFormat) {
  await build({
    root: PROJECT_ROOT,
    browser: format === "firefox" ? "firefox" : "chrome",
    manifestVersion: 3,
    vite: () => ({
      build: { sourcemap: true }
    })
  });
}

async function buildNeededFormats(formats: ExtensionFormat[]) {
  for (const format of formats) {
    console.log(`Building ${format} extension (production + source maps)...`);
    await buildExtension(format);
  }
}

// ── Debounce ─────────────────────────────────────────────────────────────────

function debounce<T extends unknown[]>(callback: (...args: T) => void | Promise<void>, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: T) => {
    if (timer !== null) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = null;
      void callback(...args);
    }, delayMs);
  };
}

// ── Child process helpers ───────────────────────────────────────────────────

function killChild(child: ChildProcess) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  if (platform() === "win32" && child.pid !== undefined) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }

  child.kill();
}

// ── Browser handles ─────────────────────────────────────────────────────────

interface BrowserHandle {
  spec: BrowserSpec;
  reloadExtension: () => Promise<void>;
  reloadTabs: () => Promise<void>;
  shutdown: () => Promise<void>;
}

async function launchChromium(spec: BrowserSpec & { vendor: ChromiumVendor }): Promise<BrowserHandle> {
  const { profileDir, cdpPort } = CHROMIUM_CONFIG[spec.vendor];
  const binary = chromiumBinaryPath(spec.vendor);
  setupChromiumProfile(profileDir, spec.vendor);

  const sharedArgs = [
    `--lang=${LANG}`,
    `--remote-debugging-port=${cdpPort}`,
    "--disable-blink-features=AutomationControlled"
  ];
  if (spec.withExtension) {
    const runner = await webExtRun.cmd.run({
      target: "chromium",
      sourceDir: CHROMIUM_OUTPUT_DIR,
      startUrl: [START_URL],
      keepProfileChanges: true,
      chromiumProfile: profileDir,
      chromiumBinary: binary,
      args: sharedArgs,
      noReload: true,
      noInput: true
    }, { shouldExitProgram: false });

    console.log(`${spec.vendor} launched with extension sideloaded.`);
    await waitForCdpReady(cdpPort);

    return {
      spec,
      reloadExtension: () => runner.reloadAllExtensions(),
      reloadTabs: () => reloadYouTubeTabsAt(cdpPort),
      shutdown: () => runner.exit()
    };
  }

  const child = spawn(binary, [
    `--user-data-dir=${profileDir}`,
    ...sharedArgs,
    "--no-first-run",
    "--no-default-browser-check",
    START_URL
  ], { stdio: "ignore" });
  child.on("error", error => console.error(`${spec.vendor} failed to launch:`, error));
  child.on("exit", (code, signal) => console.warn(`${spec.vendor} child exited (code=${code}, signal=${signal})`));
  console.log(`${spec.vendor} launched without extension (pid=${child.pid}).`);
  await waitForCdpReady(cdpPort);

  return {
    spec,
    async reloadExtension() {},
    reloadTabs: () => reloadYouTubeTabsAt(cdpPort),
    shutdown: async () => killChild(child)
  };
}

async function launchFirefox(spec: BrowserSpec): Promise<BrowserHandle> {
  killExistingFirefoxInstances();
  const profileDirectory = setupFirefoxProfile();
  if (spec.withExtension) {
    const runner = await webExtRun.cmd.run({
      target: "firefox-desktop",
      sourceDir: FIREFOX_OUTPUT_DIR,
      startUrl: [START_URL],
      keepProfileChanges: true,
      firefoxProfile: profileDirectory,
      args: [`--lang=${LANG}`, "--marionette"],
      noReload: true,
      noInput: true
    }, { shouldExitProgram: false });

    console.log("firefox launched with extension sideloaded.");

    return {
      spec,
      reloadExtension: () => runner.reloadAllExtensions(),
      async reloadTabs() {},
      shutdown: () => runner.exit()
    };
  }

  const child = spawn(firefoxBinaryPath(), [
    "--profile", profileDirectory,
    "--new-instance",
    START_URL
  ], { stdio: "ignore" });
  child.on("error", error => console.error("firefox failed to launch:", error));
  child.on("exit", (code, signal) => console.warn(`firefox child exited (code=${code}, signal=${signal})`));
  console.log(`firefox launched without extension (pid=${child.pid}).`);

  return {
    spec,
    async reloadExtension() {},
    async reloadTabs() {},
    shutdown: async () => killChild(child)
  };
}

async function launchBrowser(spec: BrowserSpec) {
  if (isChromiumSpec(spec)) {
    return launchChromium(spec);
  }

  return launchFirefox(spec);
}

// ── Main ────────────────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString().slice(11, 23);
}

function log(message: string) {
  console.log(`[${timestamp()}] ${message}`);
}

function logError(message: string, error: unknown) {
  console.error(`[${timestamp()}] ${message}`, error);
}

process.on("uncaughtException", error => {
  logError("uncaughtException", error);
});

process.on("unhandledRejection", reason => {
  logError("unhandledRejection", reason);
});

process.on("exit", code => {
  originalConsoleLog(`[${new Date().toISOString()}] [log] process exiting with code ${code}`);
  logStream.write(`[${new Date().toISOString()}] [log] process exiting with code ${code}\n`);
  logStream.end();
});

async function main() {
  process.chdir(PROJECT_ROOT);
  log(`Specs: ${browserSpecs.map(spec => `${spec.vendor}${spec.withExtension ? "" : ".no-extension"}`).join(", ")}`);

  log("Sweeping any orphan browser processes from previous runs...");
  sweepRemainingBrowsers();

  const formats = neededFormats(browserSpecs);
  await buildNeededFormats(formats);

  if (formats.length > 0) {
    log("Initial build complete.\n");
  }

  webExtConsoleStream.write = ({ level, msg: message }) => {
    if (level >= WARN_LOG_LEVEL) {
      console.warn(`[${timestamp()}] web-ext: ${message}`);
    }
  };

  const handles: BrowserHandle[] = [];
  for (const spec of browserSpecs) {
    log(`Launching ${spec.vendor} (withExtension=${spec.withExtension})...`);
    try {
      handles.push(await launchBrowser(spec));
      log(`${spec.vendor} launch complete.`);
    } catch (error) {
      logError(`Failed to launch ${spec.vendor}:`, error);
      throw error;
    }
  }

  log("\nWatching for file changes...\n");

  const watcher = chokidar.watch(["src", "wxt.config.ts"], {
    cwd: PROJECT_ROOT.replaceAll("\\", "/"),
    ignoreInitial: true,
    usePolling: true,
    interval: 500
  });

  watcher.on("error", error => logError("chokidar error:", error));
  watcher.on("ready", () => log("chokidar ready."));

  const onFileChange = debounce(async (_event: string, filePath: string) => {
    log(`\nChange detected: ${filePath}`);
    log("Rebuilding...");
    try {
      await buildNeededFormats(formats);
      log("Build complete. Reloading extensions...");
      for (const handle of handles) {
        try {
          await handle.reloadExtension();
          log(`${handle.spec.vendor}: extension reloaded.`);
        } catch (error) {
          logError(`${handle.spec.vendor}: reloadExtension failed:`, error);
        }
      }

      log("Reloading tabs...");
      for (const handle of handles) {
        try {
          await handle.reloadTabs();
          log(`${handle.spec.vendor}: tabs reloaded.`);
        } catch (error) {
          logError(`${handle.spec.vendor}: reloadTabs failed:`, error);
        }
      }

      log(`Rebuild cycle finished at ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      logError("Rebuild failed:", error);
    }
  }, REBUILD_DEBOUNCE_MS);

  watcher.on("all", (event, filePath) => onFileChange(event, filePath));

  let isShuttingDown = false;
  async function shutdown(reason: string) {
    if (isShuttingDown) {
      log(`shutdown re-entered (reason=${reason}), ignoring.`);
      return;
    }

    isShuttingDown = true;
    log(`Shutting down (reason=${reason})...`);
    try {
      await watcher.close();
      log("watcher closed.");
    } catch (error) {
      logError("watcher.close failed:", error);
    }

    for (const handle of handles) {
      try {
        await handle.shutdown();
        log(`${handle.spec.vendor}: shutdown complete.`);
      } catch (error) {
        logError(`${handle.spec.vendor}: shutdown failed:`, error);
      }
    }

    log("Sweeping any remaining browser processes by profile dir...");
    sweepRemainingBrowsers();
    log("Sweep complete.");
  }

  const terminationSignals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const;
  for (const signal of terminationSignals) {
    process.on(signal, async () => {
      log(`Received ${signal}.`);
      await shutdown(`signal=${signal}`);
      process.exit(0);
    });
  }

  await new Promise(() => {});
}

main().catch(error => {
  logError("Fatal in main():", error);
  process.exit(1);
});
