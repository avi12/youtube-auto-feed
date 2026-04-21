/**
 * Dev server: production builds (with source maps) + browser with sideloaded extension.
 * On file changes: rebuilds, reloads the extension via CDP, then reloads YouTube tabs.
 *
 * Usage: bun dev.ts
 */

import chokidar from "chokidar";
import { spawn } from "node:child_process";
import { existsSync, cpSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { resolve, join } from "node:path";
import { build } from "wxt";

const PROJECT_ROOT = resolve(import.meta.dirname);
const LANGUAGE = process.env.LANG ?? "en";
const START_URL = "https://www.youtube.com/feed/subscriptions";
const CDP_PORT = 9227;
const REBUILD_DEBOUNCE_MS = 800;
const BROWSER: "chrome" | "opera" = "opera";

// ── Browser configurations ─────────────────────────────────────────────────

interface BrowserConfig {
  name: string;
  wxtBrowser: "chrome" | "opera";
  outputDirectory: string;
  profileDirectory: string;
  binaryPath: string;
  profileSource: string;
}

function chromeConfig(): BrowserConfig {
  const binaryPath = (() => {
    switch (platform()) {
      case "win32": return join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe");
      case "darwin": return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
      default: return "/usr/bin/google-chrome";
    }
  })();

  const profileSource = (() => {
    switch (platform()) {
      case "win32": return join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data");
      case "darwin": return join(homedir(), "Library", "Application Support", "Google", "Chrome");
      default: return join(homedir(), ".config", "google-chrome");
    }
  })();

  return {
    name: "Chrome",
    wxtBrowser: "chrome",
    outputDirectory: resolve(PROJECT_ROOT, ".output/chrome-mv3"),
    profileDirectory: resolve(PROJECT_ROOT, "User Data"),
    binaryPath,
    profileSource
  };
}

function operaConfig(): BrowserConfig {
  const binaryPath = (() => {
    switch (platform()) {
      case "win32": return join(process.env.LOCALAPPDATA ?? "", "Programs", "Opera", "opera.exe");
      case "darwin": return "/Applications/Opera.app/Contents/MacOS/Opera";
      default: return "/usr/bin/opera";
    }
  })();

  const profileSource = (() => {
    switch (platform()) {
      case "win32": return join(process.env.APPDATA ?? "", "Opera Software", "Opera Stable");
      case "darwin": return join(homedir(), "Library", "Application Support", "com.operasoftware.Opera");
      default: return join(homedir(), ".config", "opera");
    }
  })();

  return {
    name: "Opera",
    wxtBrowser: "opera",
    outputDirectory: resolve(PROJECT_ROOT, ".output/opera-mv3"),
    profileDirectory: resolve(PROJECT_ROOT, "Opera Profile"),
    binaryPath,
    profileSource
  };
}

function browserConfig() {
  switch (BROWSER) {
    case "chrome": return chromeConfig();
    case "opera": return operaConfig();
  }
}

// ── Profile setup ──────────────────────────────────────────────────────────

function setupDevProfile(config: BrowserConfig) {
  const { profileDirectory, profileSource, name } = config;

  if (existsSync(profileDirectory)) {
    return;
  }

  if (!existsSync(profileSource)) {
    mkdirSync(profileDirectory, { recursive: true });
    return;
  }

  console.log(`Copying ${name} profile from ${profileSource}...`);
  cpSync(profileSource, profileDirectory, { recursive: true });
  console.log("Profile copy complete.");
}

// ── Browser launch ─────────────────────────────────────────────────────────

function launchBrowser(config: BrowserConfig) {
  const browserProcess = spawn(config.binaryPath, [
    `--user-data-dir=${config.profileDirectory}`,
    `--load-extension=${config.outputDirectory}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--lang=${LANGUAGE}`,
    "--disable-blink-features=AutomationControlled",
    START_URL
  ], {
    stdio: "ignore",
    detached: true
  });

  browserProcess.unref();
  return browserProcess;
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

async function reloadExtension() {
  const targets = await getCdpTargets();
  const serviceWorker = targets.find(
    target => target.type === "service_worker" && target.url.startsWith("chrome-extension://")
  );

  if (serviceWorker?.webSocketDebuggerUrl) {
    await sendCdpCommand(serviceWorker.webSocketDebuggerUrl, "Runtime.evaluate", { expression: "chrome.runtime.reload()" });
    return;
  }

  const backgroundPage = targets.find(
    target => target.type === "background_page" && target.url.startsWith("chrome-extension://")
  );

  if (backgroundPage?.webSocketDebuggerUrl) {
    await sendCdpCommand(backgroundPage.webSocketDebuggerUrl, "Runtime.evaluate", { expression: "chrome.runtime.reload()" });
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

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  process.chdir(PROJECT_ROOT);

  const config = browserConfig();
  setupDevProfile(config);

  console.log(`Building extension for ${config.name}...`);
  await buildExtension(config);
  console.log("Build complete.\n");

  const browserProcess = launchBrowser(config);
  console.log(`${config.name} launched with extension sideloaded.`);
  console.log("Watching for file changes...\n");

  const watcher = chokidar.watch("src", {
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
      await reloadExtensionAndTabs();
      console.log(`Reloaded at ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.error("Rebuild failed:", error);
    }
  }, REBUILD_DEBOUNCE_MS);

  watcher.on("all", (event, filePath) => onFileChange(event, filePath));

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void watcher.close();
      browserProcess.kill();
      process.exit(0);
    });
  }

  await new Promise(() => {});
}

main().catch(error => {
  console.error("Fatal:", error);
  process.exit(1);
});
