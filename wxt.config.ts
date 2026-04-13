import {
  defineConfig
} from "wxt";

export default defineConfig({
  manifest: {
    name: "YouTube Feed Live",
    version: "1.0.0",
    description:
      "Live-updates the YouTube channel feed as videos are published, removed, or change state — no page reload needed.",
    gecko: {
      id: "youtube-feed-live@avi12.com"
    }
  },
  srcDir: "src",
  publicDir: "src/public",
});
