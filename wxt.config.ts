import { auth, drive } from "@googleapis/drive";
import { strToU8, unzipSync, zipSync } from "fflate";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { defineConfig } from "wxt";

const DRIVE_CREDENTIALS_FILE = "youtube-auto-feed-drive-upload.json";

// Source zips archived in a browser-specific Drive folder rather than the default parent. (Opera
// isn't published to the Opera Add-ons store, so its source only lives here.) Folder IDs come from
// .env so they stay out of version control.
const DRIVE_FOLDER_ENV_BY_BROWSER: Record<string, string> = {
  firefox: "DRIVE_FOLDER_FIREFOX",
  opera: "DRIVE_FOLDER_OPERA"
};

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
3. Build the Opera extension: \`pnpm build -b opera\`

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
  manifest: ({ browser }) => ({
    name: "YouTube Auto Feed",
    description: "YouTube couldn't make the subscription feed dynamic, so I did",
    permissions: ["storage"],
    // Floor set by MAIN-world content scripts declared via "world": "MAIN" (Chromium 111 = Opera 97,
    // Firefox 128). Secondary features used - CSS translate/scale and structuredClone - need less.
    ...browser === "chrome" && { minimum_chrome_version: "111" },
    ...browser === "opera" && { minimum_opera_version: "97" },
    ...browser === "firefox" && {
      browser_specific_settings: {
        gecko: {
          id: "youtube-auto-feed@avi12.com",
          strict_min_version: "142.0",
          data_collection_permissions: {
            required: ["none"]
          }
        }
      }
    }
  }),
  modules: ["@wxt-dev/module-svelte"],
  srcDir: "src",
  publicDir: "src/public",
  zip: {
    // The source zip exists only so a store reviewer can reproduce the build, so it carries just the
    // build inputs - package.json, the README, the WXT config and src/. The catch-all "**/*" exclude
    // below drops everything else (dev scripts, lint configs, generated output, credentials, ...).
    includeSources: [
      "package.json",
      "README.md",
      "wxt.config.ts",
      "src/**"
    ],
    excludeSources: ["**/*"],
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
        keyFile: DRIVE_CREDENTIALS_FILE,
        scopes: "https://www.googleapis.com/auth/drive"
      });
      const client = drive({
        version: "v3",
        auth: authClient
      });
      // Firefox and Opera each archive to their own folder; everything else uses the default parent.
      const folderEnvName = DRIVE_FOLDER_ENV_BY_BROWSER[browser];
      const dedicatedFolderId = folderEnvName ? process.env[folderEnvName] : undefined;
      await client.files.create({
        requestBody: {
          name: basename(sourcesZipPath),
          parents: dedicatedFolderId ? [dedicatedFolderId] : driveConfig.parents
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
