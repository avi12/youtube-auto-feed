/**
 * Dev server: production builds (with source maps) + browser with sideloaded extension.
 * On file changes: rebuilds, reloads the extension via CDP, then reloads YouTube tabs.
 *
 * Usage:
 *   bun dev.ts                          - Sideload in Chrome (default)
 *   bun dev.ts --chrome                 - Sideload in Chrome
 *   bun dev.ts --opera                  - Sideload in Opera
 *   bun dev.ts --edge                   - Sideload in Edge
 *   bun dev.ts --firefox                - Sideload in Firefox
 *   bun dev.ts --watch                  - Watch only: rebuild and reload all running browsers
 *   bun dev.ts --watch --edge           - Watch + launch Edge with extension sideloaded
 *   bun dev.ts --watch --opera          - Watch + launch Opera with extension sideloaded
 *   bun dev.ts --watch --chrome         - Watch + launch Chrome without extension
 *   bun dev.ts --watch --edge --chrome  - Watch + launch Edge (with extension) + Chrome (without)
 */

import chokidar from "chokidar";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { resolve, join } from "node:path";
import webExtRun from "web-ext-run";
import { consoleStream as webExtConsoleStream } from "web-ext-run/util/logger";
import { build } from "wxt";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

enum Browser {
  Chrome = "chrome",
  Opera = "opera",
  Edge = "edge",
  Firefox = "firefox"
}

enum Platform {
  Windows = "win32",
  MacOS = "darwin"
}

const args = yargs(hideBin(process.argv))
  .option("chrome", { type: "boolean", default: false, description: "Target Chrome" })
  .option("opera", { type: "boolean", default: false, description: "Target Opera" })
  .option("edge", { type: "boolean", default: false, description: "Target Edge" })
  .option("firefox", { type: "boolean", default: false, description: "Target Firefox" })
  .option("watch", { type: "boolean", default: false, description: "Watch mode: rebuild and reload tabs without sideloading" })
  .parseSync();

const HAS_EXPLICIT_BROWSER_FLAG = args.chrome || args.opera || args.edge || args.firefox;

const BROWSER = (() => {
  if (args.firefox) return Browser.Firefox;
  if (args.opera) return Browser.Opera;
  if (args.edge) return Browser.Edge;
  return Browser.Chrome;
})();

const PROJECT_ROOT = resolve(import.meta.dirname);
const USER_PROFILES_DIR = resolve(PROJECT_ROOT, "user-profiles");
const LANGUAGE = process.env.LANG ?? "en";
const START_URL = "https://www.youtube.com/feed/subscriptions";
const REBUILD_DEBOUNCE_MS = 800;
const WARN_LOG_LEVEL = 40;
const SCHEDULED_RELOAD_INTERVAL_MS = 30 * 60 * 1000;

// ── Browser configurations ─────────────────────────────────────────────────

interface BrowserConfig {
  name: string;
  wxtBrowser: "chrome" | "opera" | "firefox";
  outputDirectory: string;
  profileDirectory: string;
  binaryPath: string;
  profileSource: string;
  cdpPort: number;
}

function chromeConfig(): BrowserConfig {
  const binaryPath = (() => {
    switch (platform()) {
      case Platform.Windows: return join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe");
      case Platform.MacOS: return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
      default: return "/usr/bin/google-chrome";
    }
  })();

  const profileSource = (() => {
    switch (platform()) {
      case Platform.Windows: return join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data");
      case Platform.MacOS: return join(homedir(), "Library", "Application Support", "Google", "Chrome");
      default: return join(homedir(), ".config", "google-chrome");
    }
  })();

  return {
    name: "Chrome",
    wxtBrowser: Browser.Chrome,
    outputDirectory: resolve(PROJECT_ROOT, ".output/chrome-mv3"),
    profileDirectory: join(USER_PROFILES_DIR, "chrome"),
    binaryPath,
    profileSource,
    cdpPort: 9231
  };
}

function operaConfig(): BrowserConfig {
  const binaryPath = (() => {
    switch (platform()) {
      case Platform.Windows: return join(process.env.LOCALAPPDATA ?? "", "Programs", "Opera", "opera.exe");
      case Platform.MacOS: return "/Applications/Opera.app/Contents/MacOS/Opera";
      default: return "/usr/bin/opera";
    }
  })();

  const profileSource = (() => {
    switch (platform()) {
      case Platform.Windows: return join(process.env.APPDATA ?? "", "Opera Software", "Opera Stable");
      case Platform.MacOS: return join(homedir(), "Library", "Application Support", "com.operasoftware.Opera");
      default: return join(homedir(), ".config", "opera");
    }
  })();

  return {
    name: "Opera",
    wxtBrowser: Browser.Chrome,
    outputDirectory: resolve(PROJECT_ROOT, ".output/chrome-mv3"),
    profileDirectory: join(USER_PROFILES_DIR, "opera"),
    binaryPath,
    profileSource,
    cdpPort: 9227
  };
}

function edgeConfig(): BrowserConfig {
  const binaryPath = (() => {
    switch (platform()) {
      case Platform.Windows: return join(process.env["PROGRAMFILES(X86)"] ?? process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe");
      case Platform.MacOS: return "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
      default: return "/usr/bin/microsoft-edge";
    }
  })();

  const profileSource = (() => {
    switch (platform()) {
      case Platform.Windows: return join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Edge", "User Data");
      case Platform.MacOS: return join(homedir(), "Library", "Application Support", "Microsoft Edge");
      default: return join(homedir(), ".config", "microsoft-edge");
    }
  })();

  return {
    name: "Edge",
    wxtBrowser: Browser.Chrome,
    outputDirectory: resolve(PROJECT_ROOT, ".output/chrome-mv3"),
    profileDirectory: join(USER_PROFILES_DIR, "edge"),
    binaryPath,
    profileSource,
    cdpPort: 9232
  };
}

function firefoxConfig(): BrowserConfig {
  const profileSource = (() => {
    switch (platform()) {
      case Platform.Windows: return join(process.env.APPDATA ?? "", "Mozilla", "Firefox");
      case Platform.MacOS: return join(homedir(), "Library", "Application Support", "Firefox");
      default: return join(homedir(), ".mozilla", "firefox");
    }
  })();

  return {
    name: "Firefox",
    wxtBrowser: Browser.Firefox,
    outputDirectory: resolve(PROJECT_ROOT, ".output/firefox-mv3"),
    profileDirectory: join(USER_PROFILES_DIR, "firefox"),
    binaryPath: "",
    profileSource,
    cdpPort: 0
  };
}

function browserConfig() {
  switch (BROWSER) {
    case Browser.Chrome: return chromeConfig();
    case Browser.Opera: return operaConfig();
    case Browser.Edge: return edgeConfig();
    case Browser.Firefox: return firefoxConfig();
  }
}

// ── Profile setup ──────────────────────────────────────────────────────────

const FIREFOX_SESSION_FILES = [
  "cookies.sqlite",
  "key4.db",
  "logins.json",
  "cert9.db",
  "permissions.sqlite",
  "places.sqlite",
  "favicons.sqlite"
];

function findDefaultFirefoxProfilePath(firefoxDataPath: string) {
  const profilesIniPath = join(firefoxDataPath, "profiles.ini");
  if (!existsSync(profilesIniPath)) {
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

const PROFILE_SENTINEL = ".seeded";

function setupFirefoxProfile(config: BrowserConfig) {
  const { profileDirectory, profileSource } = config;
  const sentinelPath = join(profileDirectory, PROFILE_SENTINEL);

  if (existsSync(sentinelPath)) {
    return profileDirectory;
  }

  mkdirSync(profileDirectory, { recursive: true });

  const source = existsSync(profileSource)
    ? findDefaultFirefoxProfilePath(profileSource)
    : null;

  if (source && existsSync(source)) {
    console.log(`Copying Firefox profile from ${source}...`);
    for (const file of FIREFOX_SESSION_FILES) {
      const sourcePath = join(source, file);
      if (existsSync(sourcePath)) {
        cpSync(sourcePath, join(profileDirectory, file));
      }
    }
    console.log("Profile copy complete.");
  }

  writeFileSync(sentinelPath, "");
  return profileDirectory;
}

const CHROMIUM_CACHE_DIRS = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "ShaderCache",
  "blob_storage",
  "optimization_guide_prediction_models"
]);

function setupChromiumProfile(config: BrowserConfig) {
  const { profileDirectory, profileSource, name } = config;
  const sentinelPath = join(profileDirectory, PROFILE_SENTINEL);

  if (existsSync(sentinelPath)) {
    return;
  }

  mkdirSync(profileDirectory, { recursive: true });

  const sourceDefaultDir = join(profileSource, "Default");
  if (existsSync(sourceDefaultDir)) {
    console.log(`Cloning ${name} profile from ${sourceDefaultDir}...`);
    const destinationDefaultDir = join(profileDirectory, "Default");
    mkdirSync(destinationDefaultDir, { recursive: true });
    try {
      cpSync(sourceDefaultDir, destinationDefaultDir, {
        recursive: true,
        filter: (sourcePath) => {
          const relative = sourcePath.slice(sourceDefaultDir.length).replace(/^[/\\]/, "");
          const topLevel = relative.split(/[/\\]/)[0];
          return !CHROMIUM_CACHE_DIRS.has(topLevel);
        }
      });
      console.log("Profile clone complete.");
    } catch (error) {
      console.log(`  Clone incomplete (some files locked — close ${name} first for full login state): ${error}`);
    }
  }

  writeFileSync(sentinelPath, "");
}

// ── Browser launch ─────────────────────────────────────────────────────────

const activeBrowserProcesses = new Set<ChildProcess>();

function launchBrowser(config: BrowserConfig, loadExtension = true) {
  console.log(`Launching: ${config.binaryPath}`);
  const browserProcess = spawn(config.binaryPath, [
    `--user-data-dir=${config.profileDirectory}`,
    ...(loadExtension ? [`--load-extension=${config.outputDirectory}`] : []),
    `--remote-debugging-port=${config.cdpPort}`,
    `--lang=${LANGUAGE}`,
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-background-networking",
    "--new-window",
    START_URL
  ], {
    stdio: ["ignore", "ignore", "pipe"]
  });
  activeBrowserProcesses.add(browserProcess);
  browserProcess.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  browserProcess.on("error", error => console.error(`Failed to launch ${config.name}:`, error));
  browserProcess.on("exit", (code, signal) => {
    activeBrowserProcesses.delete(browserProcess);
    console.log(`${config.name} exited (code=${code}, signal=${signal})`);
  });
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

// ── CDP helpers ────────────────────────────────────────────────────────────

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

async function getCdpTargets(cdpPort: number) {
  const response = await fetch(`http://localhost:${cdpPort}/json`);
  return await response.json() as CdpTarget[];
}

async function findOurExtensionTarget(cdpPort: number) {
  const targets = await getCdpTargets(cdpPort);
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

async function wakeExtensionServiceWorker(cdpPort: number) {
  const targets = await getCdpTargets(cdpPort);
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

async function reloadExtension(cdpPort: number) {
  let target = await findOurExtensionTarget(cdpPort);

  if (!target) {
    await wakeExtensionServiceWorker(cdpPort);
    target = await findOurExtensionTarget(cdpPort);
  }

  if (target?.webSocketDebuggerUrl) {
    await sendCdpCommand(target.webSocketDebuggerUrl, "Runtime.evaluate", { expression: "chrome.runtime.reload()" });
  }
}

async function reloadYouTubeTabs(cdpPort: number) {
  const targets = await getCdpTargets(cdpPort);

  for (const target of targets) {
    if (target.type !== "page" || !target.url.includes("youtube.com") || !target.webSocketDebuggerUrl) {
      continue;
    }

    await sendCdpCommand(target.webSocketDebuggerUrl, "Page.reload");
  }
}

async function reloadExtensionAndTabs(cdpPort: number) {
  try {
    await reloadExtension(cdpPort);
    await reloadYouTubeTabs(cdpPort);
  } catch {
    // CDP not available yet
  }
}

async function waitForBrowserClose(cdpPort: number) {
  const cdpUrl = `http://localhost:${cdpPort}/json/version`;

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

// ── Build ──────────────────────────────────────────────────────────────────

async function buildExtension(config: BrowserConfig) {
  await build({
    root: PROJECT_ROOT,
    browser: config.wxtBrowser,
    manifestVersion: 3,
    vite: () => ({ build: { sourcemap: true } })
  });
}

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

// ── Firefox dev loop ───────────────────────────────────────────────────────

async function runFirefox(config: BrowserConfig) {
  const profileDirectory = setupFirefoxProfile(config);

  console.log("Building extension for Firefox...");
  await buildExtension(config);
  console.log("Build complete.\n");

  webExtConsoleStream.write = ({ level, msg }) => {
    if (level >= WARN_LOG_LEVEL) {
      console.warn(msg);
    }
  };

  const runner = await webExtRun.cmd.run({
    target: "firefox-desktop",
    sourceDir: config.outputDirectory,
    startUrl: [START_URL],
    keepProfileChanges: true,
    firefoxProfile: profileDirectory,
    args: [`--lang=${LANGUAGE}`, "--marionette"],
    noReload: true,
    noInput: true
  }, { shouldExitProgram: false });

  console.log("Firefox launched with extension sideloaded.");
  console.log("Watching for file changes...\n");

  const watcher = chokidar.watch(["src", "wxt.config.ts"], {
    cwd: PROJECT_ROOT,
    ignoreInitial: true,
    usePolling: true,
    interval: 500
  });

  const onFileChange = debounce(async (_event: string, filePath: string) => {
    console.log(`\nChange detected: ${filePath}`);
    console.log("Rebuilding...");
    try {
      await buildExtension(config);
      await runner.reloadAllExtensions();
      console.log(`Reloaded at ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.error("Rebuild failed:", error);
    }
  }, REBUILD_DEBOUNCE_MS);

  watcher.on("all", (event, filePath) => onFileChange(event, filePath));

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, async () => {
      await watcher.close();
      await runner.exit();
      process.exit(0);
    });
  }

  await new Promise(() => {});
}

// ── Chromium dev loop ──────────────────────────────────────────────────────

async function runChromium(config: BrowserConfig) {
  setupChromiumProfile(config);

  console.log(`Building extension for ${config.name}...`);
  await buildExtension(config);
  console.log("Build complete.\n");

  const browserProcess = launchBrowser(config);
  console.log(`${config.name} launched with extension sideloaded.`);
  console.log("Watching for file changes...\n");

  const watcher = chokidar.watch(["src", "wxt.config.ts"], {
    cwd: PROJECT_ROOT,
    ignoreInitial: true,
    usePolling: true,
    interval: 500
  });

  const onFileChange = debounce(async (_event: string, filePath: string) => {
    console.log(`\nChange detected: ${filePath}`);
    console.log("Rebuilding...");
    try {
      await buildExtension(config);
      await reloadExtensionAndTabs(config.cdpPort);
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

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      shutdown();
      process.exit(0);
    });
  }
  process.on("exit", shutdown);

  await waitForBrowserClose(config.cdpPort);
  if (!isShuttingDown) {
    shutdown();
    process.exit(0);
  }
}

// ── Watch-only loop ────────────────────────────────────────────────────────

async function runWatch() {
  const buildConfig = chromeConfig();

  console.log("Building extension...");
  await buildExtension(buildConfig);
  console.log("Build complete.\n");

  const launchedProcesses: ChildProcess[] = [];
  const launchedPorts: number[] = [];

  if (args.edge) {
    const config = edgeConfig();
    setupChromiumProfile(config);
    launchedProcesses.push(launchBrowser(config, true));
    launchedPorts.push(config.cdpPort);
    console.log("Edge launched with extension sideloaded.");
  }

  if (args.opera) {
    const config = operaConfig();
    setupChromiumProfile(config);
    launchedProcesses.push(launchBrowser(config, true));
    launchedPorts.push(config.cdpPort);
    console.log("Opera launched with extension sideloaded.");
  }

  if (args.chrome) {
    const config = chromeConfig();
    setupChromiumProfile(config);
    launchedProcesses.push(launchBrowser(config, false));
    launchedPorts.push(config.cdpPort);
    console.log("Chrome launched (extension not loaded).");
  }

  console.log("Watching for file changes...\n");

  const watcher = chokidar.watch(["src", "wxt.config.ts"], {
    cwd: PROJECT_ROOT,
    ignoreInitial: true,
    usePolling: true,
    interval: 500
  });

  const onFileChange = debounce(async (_event: string, filePath: string) => {
    console.log(`\nChange detected: ${filePath}`);
    console.log("Rebuilding...");
    try {
      await buildExtension(buildConfig);
      await Promise.allSettled([
        reloadExtensionAndTabs(chromeConfig().cdpPort),
        reloadExtensionAndTabs(edgeConfig().cdpPort),
        reloadExtensionAndTabs(operaConfig().cdpPort)
      ]);
      console.log(`Reloaded at ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.error("Rebuild failed:", error);
    }
  }, REBUILD_DEBOUNCE_MS);

  watcher.on("all", (event, filePath) => onFileChange(event, filePath));

  let scheduledReloadTimer: ReturnType<typeof setInterval> | null = null;

  if (args.edge && args.chrome) {
    scheduledReloadTimer = setInterval(async () => {
      console.log("\nScheduled reload...");
      await Promise.allSettled([
        reloadYouTubeTabs(chromeConfig().cdpPort),
        reloadYouTubeTabs(edgeConfig().cdpPort)
      ]);
      console.log("Reloaded.");
    }, SCHEDULED_RELOAD_INTERVAL_MS);
  }

  let isShuttingDown = false;
  const shutdown = () => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    if (scheduledReloadTimer !== null) {
      clearInterval(scheduledReloadTimer);
    }
    for (const browserProcess of launchedProcesses) {
      killBrowserTree(browserProcess);
    }
    void watcher.close();
  };

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      shutdown();
      process.exit(0);
    });
  }
  process.on("exit", shutdown);

  if (launchedPorts.length > 0) {
    await Promise.race(launchedPorts.map(port => waitForBrowserClose(port)));
    if (!isShuttingDown) {
      shutdown();
      process.exit(0);
    }
  } else {
    await new Promise(() => {});
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

function killAllBrowsers() {
  for (const browserProcess of activeBrowserProcesses) {
    killBrowserTree(browserProcess);
  }
}

async function main() {
  process.chdir(PROJECT_ROOT);

  process.on("exit", killAllBrowsers);
  process.on("uncaughtException", error => {
    console.error("Uncaught exception:", error);
    killAllBrowsers();
    process.exit(1);
  });

  if (args.watch) {
    await runWatch();
    return;
  }

  const config = browserConfig();

  if (BROWSER === Browser.Firefox) {
    await runFirefox(config);
    return;
  }

  await runChromium(config);
}

main().catch(error => {
  console.error("Fatal:", error);
  process.exit(1);
});
