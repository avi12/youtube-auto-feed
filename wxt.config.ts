import { auth, drive } from "@googleapis/drive";
import { strToU8, unzipSync, zipSync } from "fflate";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { defineConfig } from "wxt";

const DRIVE_CREDENTIALS_FILE = "youtube-auto-feed-drive-upload.json";

// Opera isn't published to the Opera Add-ons store; its source zip is archived in this Drive folder.
const OPERA_DRIVE_FOLDER_ID = "1X0baGCRRcc6svI96PQ9BXtOwdKLeRtYZ";

// A store's source zip is reviewed by humans who must reproduce the build, so it ships build (not
// install) instructions. The only per-browser difference is the build target.
const BUILD_INSTRUCTIONS_FIREFOX = `# Build instructions

YouTube Auto Feed is built with the WXT framework (https://wxt.dev).

## Requirements
- Node.js 20 or newer
- pnpm (the exact version is pinned in package.json "packageManager"; run \`corepack enable\` to use it)

## Steps
1. Extract this source archive
2. Install dependencies: \`pnpm install\`
3. Build the Firefox extension: \`pnpm build:firefox\`

The unpacked build is written to .output/firefox-mv3/; \`pnpm zip:firefox\` produces the uploadable zip.
`;

const BUILD_INSTRUCTIONS_OPERA = `# Build instructions

YouTube Auto Feed is built with the WXT framework (https://wxt.dev).

## Requirements
- Node.js 20 or newer
- pnpm (the exact version is pinned in package.json "packageManager"; run \`corepack enable\` to use it)

## Steps
1. Extract this source archive
2. Install dependencies: \`pnpm install\`
3. Build the Opera extension: \`pnpm exec wxt build -b opera\`

The unpacked build is written to .output/opera-mv3/.
`;

const driveConfig: { parents?: string[] } = existsSync(DRIVE_CREDENTIALS_FILE)
  ? JSON.parse(readFileSync(DRIVE_CREDENTIALS_FILE, "utf-8"))
  : {};

function buildInstructionsFor(browser: string) {
  if (browser === "firefox") {
    return BUILD_INSTRUCTIONS_FIREFOX;
  }

  if (browser === "opera") {
    return BUILD_INSTRUCTIONS_OPERA;
  }

  return null;
}

async function injectBuildInstructions(zipPath: string, content: string) {
  const entries = unzipSync(await readFile(zipPath));
  entries["BUILD.md"] = strToU8(content);
  await writeFile(zipPath, zipSync(entries));
}

export default defineConfig({
  manifest: {
    name: "YouTube Auto Feed",
    description:
      "Keeps your YouTube subscriptions feed current as videos are published, removed, or change state - no page reload needed.",
    permissions: ["storage"],
    browser_specific_settings: {
      gecko: { id: "youtube-auto-feed@avi12.com" }
    }
  },
  modules: ["@wxt-dev/module-svelte"],
  srcDir: "src",
  publicDir: "src/public",
  zip: {
    excludeSources: [DRIVE_CREDENTIALS_FILE, "user-profiles/**", "screenshots/**", "tmp/**"],
    sourcesTemplate: "{{name}}-{{version}}-{{browser}}-source.zip"
  },
  hooks: {
    async "zip:sources:done"(wxt, sourcesZipPath) {
      const { browser } = wxt.config;

      // Firefox and Opera require a reviewable source submission; bundle build instructions so the
      // store reviewer can reproduce the build from this zip.
      const buildInstructions = buildInstructionsFor(browser);
      if (buildInstructions) {
        await injectBuildInstructions(sourcesZipPath, buildInstructions);
      }

      if (!existsSync(DRIVE_CREDENTIALS_FILE)) {
        return;
      }

      const authClient = new auth.GoogleAuth({
        keyFilename: DRIVE_CREDENTIALS_FILE,
        scopes: "https://www.googleapis.com/auth/drive"
      });
      const client = drive({
        version: "v3",
        auth: authClient
      });
      // Opera has its own dedicated Drive folder; everything else goes to the default parent.
      const parents = browser === "opera" ? [OPERA_DRIVE_FOLDER_ID] : driveConfig.parents;
      await client.files.create({
        requestBody: {
          name: basename(sourcesZipPath),
          parents
        },
        media: {
          mimeType: "application/zip",
          body: createReadStream(sourcesZipPath)
        },
        fields: "id"
      });
    }
  },
  vite: () => ({
    build: { sourcemap: false }
  })
});
