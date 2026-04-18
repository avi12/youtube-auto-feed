import { detectAndApplyChanges } from "./detect-changes";
import { readDomSnapshot } from "./dom/query";
import { fetchInitialVideos } from "./fetch-initial-data";
import { isOnSubscriptionsPage } from "./helpers";
import { isInnerTubeBrowseResponse, parseApiResponse } from "./parse";
import { isDomContentReady } from "./readiness";
import { type VideoSnapshot } from "./types";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  main() {
    let lastSnapshot = new Map<string, VideoSnapshot>();
    let isDomReady = false;
    let isApplyingChanges = false;
    let contentObserver: MutationObserver | null = null;
    let pendingApiSnapshots: VideoSnapshot[] | null = null;
    let pendingApiSnapshotsTime = 0;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;
    let focusDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    async function applyChanges(freshSnapshots: VideoSnapshot[]) {
      if (isApplyingChanges) return false;
      isApplyingChanges = true;
      try {
        const { isLayoutChange, snapshot } = await detectAndApplyChanges(lastSnapshot, freshSnapshots);
        lastSnapshot = snapshot;
        return isLayoutChange;
      } finally {
        isApplyingChanges = false;
      }
    }

    function handleBrowseResponse(event: Event) {
      if (!isOnSubscriptionsPage() || !(event instanceof CustomEvent)) {
        return;
      }

      if (!isInnerTubeBrowseResponse(event.detail)) {
        return;
      }

      const snapshots = parseApiResponse(event.detail);
      if (snapshots.length === 0) {
        return;
      }

      pendingApiSnapshots = snapshots;
      pendingApiSnapshotsTime = Date.now();
      if (isDomReady) {
        void applyChanges(snapshots);
      }
    }

    async function fetchFreshVideos() {
      if (!isOnSubscriptionsPage() || !isDomReady) {
        return false;
      }

      const snapshots = await fetchInitialVideos();
      if (!snapshots) {
        return false;
      }

      try {
        return await applyChanges(snapshots);
      } catch {
        return false;
      }
    }

    function handleSubscriptionChange() {
      void fetchFreshVideos();
    }

    function restartPolling() {
      if (pollingTimer !== null) {
        clearInterval(pollingTimer);
      }
      pollingTimer = setInterval(() => {
        void fetchFreshVideos();
      }, 5000);
    }

    function handlePageFocus() {
      if (document.hidden || !isOnSubscriptionsPage() || !isDomReady) {
        return;
      }

      if (focusDebounceTimer !== null) {
        clearTimeout(focusDebounceTimer);
      }

      focusDebounceTimer = setTimeout(() => {
        focusDebounceTimer = null;
        if (pollingTimer !== null) {
          clearInterval(pollingTimer);
          pollingTimer = null;
        }
        void fetchFreshVideos().finally(() => restartPolling());
      }, 300);
    }

    function stopMonitoring() {
      removeEventListener("ytsua-browse-response", handleBrowseResponse);
      removeEventListener("ytsua-subscription-change", handleSubscriptionChange);
      document.removeEventListener("visibilitychange", handlePageFocus);
      broadcastChannel.onmessage = null;
      if (focusDebounceTimer !== null) {
        clearTimeout(focusDebounceTimer);
        focusDebounceTimer = null;
      }
      if (pollingTimer !== null) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }

      if (contentObserver !== null) {
        contentObserver.disconnect();
        contentObserver = null;
      }
    }

    const broadcastChannel = new BroadcastChannel("ytsua");

    function startMonitoring() {
      addEventListener("ytsua-browse-response", handleBrowseResponse);
      addEventListener("ytsua-subscription-change", handleSubscriptionChange);
      document.addEventListener("visibilitychange", handlePageFocus);
      broadcastChannel.onmessage = handleSubscriptionChange;
      restartPolling();
    }

    function applyDomBaseline() {
      isDomReady = true;
      lastSnapshot = readDomSnapshot();
      if (pendingApiSnapshots !== null) {
        void applyChanges(pendingApiSnapshots);
        pendingApiSnapshots = null;
      }
    }

    function initializePage() {
      isDomReady = false;
      lastSnapshot.clear();
      if (Date.now() - pendingApiSnapshotsTime >= 5000) {
        pendingApiSnapshots = null;
      }

      if (isDomContentReady()) {
        applyDomBaseline();
        return;
      }

      contentObserver = new MutationObserver(() => {
        if (isDomContentReady()) {
          contentObserver?.disconnect();
          contentObserver = null;
          applyDomBaseline();
        }
      });
      contentObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    function handleNavigation() {
      stopMonitoring();
      if (isOnSubscriptionsPage()) {
        initializePage();
        startMonitoring();
      }
    }

    document.addEventListener("yt-navigate-finish", handleNavigation);
    handleNavigation();
  }
});
