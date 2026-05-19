import { checkLayoutIntegrity } from "./debug/layout-integrity";
import { createSubscriptionMonitor } from "./monitor";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  main() {
    const monitor = createSubscriptionMonitor();
    document.addEventListener("yt-navigate-finish", monitor.handleNavigation);
    monitor.handleNavigation();
    (globalThis as Record<string, unknown>).__ytsuaDebug = { checkLayoutIntegrity, pausePolling: monitor.pausePolling, resumePolling: monitor.resumePolling, fetchFreshVideos: monitor.fetchFreshVideos };
  }
});
