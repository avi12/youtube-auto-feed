import { createSubscriptionMonitor } from "../subscription-feed";
import { initSettingsClient, isExtensionEnabled, onSettingsChange } from "../subscription-feed/settings-state";

declare global {
  var __ytafDebug: {
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
    onSettingsChange(() => monitor.setEnabled(isExtensionEnabled()));
    initSettingsClient();
    document.addEventListener("yt-navigate-finish", monitor.handleNavigation);
    monitor.handleNavigation();
    monitor.setEnabled(isExtensionEnabled());
    globalThis.__ytafDebug = {
      pausePolling: monitor.pausePolling,
      resumePolling: monitor.resumePolling,
      fetchFreshVideos: monitor.fetchFreshVideos
    };
  }
});
