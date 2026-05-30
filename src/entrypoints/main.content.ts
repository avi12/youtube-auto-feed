import { checkLayoutIntegrity, createSubscriptionMonitor } from "../subscription-feed";

declare global {
  var __ytsuaDebug: {
    checkLayoutIntegrity: typeof checkLayoutIntegrity;
    pausePolling: () => void;
    resumePolling: () => void;
    fetchFreshVideos: (isInitialLoad?: boolean) => Promise<boolean>;
  } | undefined;
}

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  main() {
    const monitor = createSubscriptionMonitor();
    document.addEventListener("yt-navigate-finish", monitor.handleNavigation);
    monitor.handleNavigation();
    globalThis.__ytsuaDebug = {
      checkLayoutIntegrity,
      pausePolling: monitor.pausePolling,
      resumePolling: monitor.resumePolling,
      fetchFreshVideos: monitor.fetchFreshVideos
    };
  }
});
