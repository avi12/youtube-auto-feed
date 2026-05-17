import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "YouTube Auto Feed",
    version: "1.0.0",
    description:
      "Keeps your YouTube subscriptions feed current as videos are published, removed, or change state - no page reload needed.",
    browser_specific_settings: {
      gecko: { id: "youtube-now-feed@avi12.com" }
    }
  },
  srcDir: "src",
  modules: ["@wxt-dev/auto-icons"],
  autoIcons: { baseIconPath: "assets/icon.svg" },
  vite: ({ mode }) => ({
    build: { sourcemap: mode === "development" }
  })
});
