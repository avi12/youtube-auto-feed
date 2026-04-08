import {
  defineConfig 
} from "wxt";

export default defineConfig({
  manifest: {
    name: "YouTube Subscriptions Updater",
    version: "1.0.0",
    description:
      "Polls the YouTube Subscriptions feed every 5 seconds and updates the UI when videos are added, removed, or changed."
  },
  srcDir: "src",
  publicDir: "src/public",
});
