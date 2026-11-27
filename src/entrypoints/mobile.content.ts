import { startMobileFeedMonitor } from "@/mobile-feed/monitor";
import { initSettingsClient } from "@/subscription-feed/settings-state";

export default defineContentScript({
  matches: ["https://m.youtube.com/*"],
  world: "MAIN",
  main() {
    initSettingsClient();
    startMobileFeedMonitor();
  }
});
