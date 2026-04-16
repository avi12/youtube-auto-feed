import {
  defineConfig
} from "wxt";

export default defineConfig({
  manifest: {
    name: "YouTube Raw Feed",
    version: "1.0.0",
    description:
      "Keeps your YouTube subscriptions feed current as videos are published, removed, or change state - no page reload needed.",
    browser_specific_settings: {
      gecko: {
        id: "youtube-raw-feed@avi12.com"
      }
    }
  },
  srcDir: "src",
  publicDir: "src/public",
});
