import { strToU8, unzipSync, zipSync } from "fflate";
import { readFile, writeFile } from "node:fs/promises";
import { defineConfig } from "wxt";

// A store's source zip is reviewed by humans who must reproduce the build, so it ships build (not
// install) instructions. The only per-browser difference is the build target.
const BUILD_INSTRUCTIONS_FIREFOX = `# Build instructions

YouTube Auto Feed is built with the WXT framework (https://wxt.dev).

## Requirements
- Node.js 22.13 or newer
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
- Node.js 22.13 or newer
- pnpm (the exact version is pinned in package.json "packageManager"; run \`corepack enable\` to use it)

## Steps
1. Extract this source archive
2. Install dependencies: \`pnpm install\`
3. Build the Opera extension: \`pnpm build -b opera\`

The unpacked build is written to .output/opera-mv3/.
`;

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
      // Reuse the popup as the extension's options page so it has a standalone settings entry in
      // about:addons (add open_in_new_tab: true to open it as a full tab instead of the inline frame).
      options_ui: {
        page: "popup.html"
      },
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
    }
  },
  vite: () => ({
    build: { sourcemap: false },
    // Strips the __ytafDebug inspection bridge from store builds; the dev server overrides this to true.
    define: { __YTAF_DEBUG__: "false" }
  })
});
