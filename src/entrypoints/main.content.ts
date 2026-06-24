import { createSubscriptionMonitor } from "../subscription-feed";
import { initSettingsClient, isExtensionEnabled, onSettingsChange } from "../subscription-feed/settings-state";

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
  }
});
