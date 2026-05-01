import { createSubscriptionMonitor } from "./monitor";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  main() {
    const monitor = createSubscriptionMonitor();
    document.addEventListener("yt-navigate-finish", monitor.handleNavigation);
    monitor.handleNavigation();
  }
});
