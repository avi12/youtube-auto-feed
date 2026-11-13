import { THUMBNAIL_WATCH_INTERVAL_MS } from "@/subscription-feed/dom/update/thumbnail-content-watch";
import { isMainPlayerVideo, refreshVideoPage, resetVideoPageTracking } from "@/subscription-feed/dom/video-page";
import { isVideoPageUpdatesEnabled } from "@/subscription-feed/settings-state";
import { isOnVideoPage, videoIdFromLocation } from "@/subscription-feed/utils/subscriptions-page";

import { METADATA_POLL_INTERVAL_MS, type HandlerDeps } from "./polling-state";

// The opt-in video page monitor (/watch and /shorts). It runs while the viewer has it switched on and
// the extension is enabled: switching it on refreshes at once and then every 10s, switching it off stops
// it. A video finishing refreshes at once, so the end screen opens on current suggestions, and so does
// the tab coming back into view. While the tab is hidden, ticks are skipped.

export function createVideoPageHandlers({ state, getContext }: HandlerDeps) {

  function isVideoPageMonitorWanted() {
    return isOnVideoPage() && state.isEnabled && isVideoPageUpdatesEnabled();
  }

  async function refreshVideoPageNow() {
    const videoId = videoIdFromLocation();
    const isRefreshEligible =
      state.monitorMode === "video" &&
      isVideoPageMonitorWanted() &&
      !!videoId &&
      !state.isApplyingChanges &&
      !document.hidden;
    if (!isRefreshEligible) {
      return;
    }

    const isPictureCheckDue = Date.now() - state.lastThumbnailWatchTime >= THUMBNAIL_WATCH_INTERVAL_MS;
    if (isPictureCheckDue) {
      state.lastThumbnailWatchTime = Date.now();
    }

    state.isApplyingChanges = true;
    try {
      await refreshVideoPage({
        videoId,
        isPictureCheckDue
      });
    } finally {
      state.isApplyingChanges = false;
    }
  }

  function handleVideoEnded(event: Event) {
    if (!isMainPlayerVideo(event.target)) {
      return;
    }

    state.lastThumbnailWatchTime = 0;
    refreshVideoPageNow().catch(() => {});
  }

  function handleVideoPageVisibility() {
    if (!document.hidden) {
      refreshVideoPageNow().catch(() => {});
    }
  }

  function startVideoMonitoring(isImmediate: boolean) {
    state.monitorMode = "video";
    state.lastThumbnailWatchTime = isImmediate ? 0 : Date.now();
    // Media events do not bubble; a capturing listener still sees the player's <video> end.
    document.addEventListener("ended", handleVideoEnded, { capture: true });
    document.addEventListener("visibilitychange", handleVideoPageVisibility);
    state.metadataPollingTimer = setInterval(() => {
      refreshVideoPageNow().catch(() => {});
    }, METADATA_POLL_INTERVAL_MS);

    if (isImmediate) {
      refreshVideoPageNow().catch(() => {});
    }
  }

  function stopVideoMonitoring() {
    document.removeEventListener("ended", handleVideoEnded, { capture: true });
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

    getContext().stopMonitoring();

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
