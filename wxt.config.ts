import { auth, drive } from "@googleapis/drive";
import JSZip from "jszip";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { defineConfig } from "wxt";

const DRIVE_CREDENTIALS_FILE = "youtube-auto-feed-drive-upload.json";

// Opera isn't published to the Opera Add-ons store; its build is distributed through this Drive folder.
const OPERA_DRIVE_FOLDER_ID = "1X0baGCRRcc6svI96PQ9BXtOwdKLeRtYZ";

const INSTALL_README_FIREFOX = `# YouTube Auto Feed - Firefox

Install from Firefox Add-ons (AMO):
https://addons.mozilla.org/firefox/addon/youtube-auto-feed/

A build is also mirrored on Google Drive.

To load a build manually (temporary install):
1. Open about:debugging#/runtime/this-firefox
2. Click "Load Temporary Add-on..."
3. Select the extension's manifest.json
`;

const INSTALL_README_OPERA = `# YouTube Auto Feed - Opera

Download the latest Opera build from Google Drive:
https://drive.google.com/drive/folders/1X0baGCRRcc6svI96PQ9BXtOwdKLeRtYZ?usp=drive_link

To install in Opera:
1. Unzip the downloaded archive
2. Open opera://extensions
3. Enable "Developer mode" (top-right)
4. Click "Load unpacked" and select the unzipped folder
`;

const driveConfig: { parents?: string[] } = existsSync(DRIVE_CREDENTIALS_FILE)
  ? JSON.parse(readFileSync(DRIVE_CREDENTIALS_FILE, "utf-8"))
  : {};

function installReadmeFor(browser: string) {
  if (browser === "firefox") {
    return INSTALL_README_FIREFOX;
  }

  if (browser === "opera") {
    return INSTALL_README_OPERA;
  }

  return null;
}

async function injectInstallReadme(zipPath: string, content: string) {
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  zip.file("INSTALL.md", content);
  await writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
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

      // Firefox and Opera builds are sideloaded/distributed outside the Chrome Web Store, so bundle a
      // browser-specific install guide into their source zips.
      const installReadme = installReadmeFor(browser);
      if (installReadme) {
        await injectInstallReadme(sourcesZipPath, installReadme);
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
