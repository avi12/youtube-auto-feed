import { refreshVideoPage, resetVideoPageTracking } from "../dom/video-page";
import { isVideoPageUpdatesEnabled } from "../settings-state";
import { isOnVideoPage, videoIdFromLocation } from "../utils/subscriptions-page";
import { METADATA_POLL_INTERVAL_MS, type MonitorContext } from "./polling-state";

// The opt-in video page monitor (/watch and /shorts). It runs while the viewer has it switched on and
// the extension is enabled: switching it on refreshes at once and then every 10s, switching it off stops
// it. The tab coming back into view refreshes at once too; while it is hidden, ticks are skipped.

export function createVideoPageHandlers(context: MonitorContext) {
  const { state } = context;

  function isVideoPageMonitorWanted() {
    return isOnVideoPage() && state.isEnabled && isVideoPageUpdatesEnabled();
  }

  async function refreshVideoPageNow() {
    const videoId = videoIdFromLocation();
    const isRefreshEligible = state.monitorMode === "video"
      && isVideoPageMonitorWanted()
      && !!videoId
      && !state.isApplyingChanges
      && !document.hidden;
    if (!isRefreshEligible) {
      return;
    }

    state.isApplyingChanges = true;
    try {
      await refreshVideoPage({ videoId });
    } finally {
      state.isApplyingChanges = false;
    }
  }

  function handleVideoPageVisibility() {
    if (!document.hidden) {
      refreshVideoPageNow().catch(() => {});
    }
  }

  function startVideoMonitoring(isImmediate: boolean) {
    state.monitorMode = "video";
    document.addEventListener("visibilitychange", handleVideoPageVisibility);
    state.metadataPollingTimer = setInterval(() => {
      refreshVideoPageNow().catch(() => {});
    }, METADATA_POLL_INTERVAL_MS);

    if (isImmediate) {
      refreshVideoPageNow().catch(() => {});
    }
  }

  function stopVideoMonitoring() {
    document.removeEventListener("visibilitychange", handleVideoPageVisibility);
    resetVideoPageTracking();
  }

  // A video page that just loaded already shows fresh data, so navigation waits a tick before the first
  // refresh; the viewer switching the monitor on (or re-enabling the extension) refreshes at once.
  function initializeVideoPage() {
    if (isVideoPageMonitorWanted()) {
      startVideoMonitoring(false);
    }
  }

  function syncVideoPageMonitor() {
    const isActive = state.monitorMode === "video";
    const isWanted = isVideoPageMonitorWanted();
    if (isActive === isWanted) {
      return;
    }

    context.stopMonitoring();

    if (isWanted) {
      startVideoMonitoring(true);
    }
  }

  return {
    refreshVideoPage: refreshVideoPageNow,
    initializeVideoPage,
    stopVideoMonitoring,
    syncVideoPageMonitor
  };
}
