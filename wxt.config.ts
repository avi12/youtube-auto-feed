import { auth, drive } from "@googleapis/drive";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { defineConfig } from "wxt";

const DRIVE_CREDENTIALS_FILE = "youtube-auto-feed-drive-upload.json";

const driveConfig: { parents?: string[] } = existsSync(DRIVE_CREDENTIALS_FILE)
  ? JSON.parse(readFileSync(DRIVE_CREDENTIALS_FILE, "utf-8"))
  : {};

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
    async "zip:sources:done"(_, sourcesZipPath) {
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
      await client.files.create({
        requestBody: {
          name: basename(sourcesZipPath),
          parents: driveConfig.parents
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
