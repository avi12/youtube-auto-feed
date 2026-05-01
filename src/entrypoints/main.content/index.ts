import { fetchInitialVideos } from "./api/fetch";
import { isInnerTubeBrowseResponse } from "./api/guards";
import { parseApiResponse } from "./api/parse";
import { detectAndApplyChanges, detectAndApplyMetadataChanges } from "./detect-changes";
import { type BandLayout, captureBandLayout, consolidateStandaloneItems } from "./dom/add-grid";
import { resetLazyUpdates } from "./dom/lazy-update";
import { readDomSnapshot } from "./dom/query";
import { isOnSubscriptionsPage } from "./helpers";
import { isDomContentReady } from "./readiness";
import { ytsuaChannel } from "../../messaging";
import { type VideoSnapshot } from "./types";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  main() {
    let lastSnapshot = new Map<string, VideoSnapshot>();
    let isDomReady = false;
    let isApplyingChanges = false;
    let pendingApplySnapshots: VideoSnapshot[] | null = null;
    let contentObserver: MutationObserver | null = null;
    let pendingApiSnapshots: VideoSnapshot[] | null = null;
    let pendingApiSnapshotsTime = 0;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;
    let metadataPollingTimer: ReturnType<typeof setInterval> | null = null;
    let cancelBroadcastListener: (() => void) | null = null;
    let initialBandLayout: BandLayout | null = null;

    async function applyChanges(freshSnapshots: VideoSnapshot[]) {
      if (isApplyingChanges) {
        pendingApplySnapshots = freshSnapshots;
        return false;
      }

      isApplyingChanges = true;
      try {
        let snapshotsToApply: VideoSnapshot[] | null = freshSnapshots;
        let isAnyLayoutChange = false;
        while (snapshotsToApply !== null) {
          pendingApplySnapshots = null;
          const { isLayoutChange, snapshot } = await detectAndApplyChanges(lastSnapshot, snapshotsToApply, initialBandLayout);
          lastSnapshot = snapshot;
          if (isLayoutChange) {
            isAnyLayoutChange = true;
            initialBandLayout = captureBandLayout();
          }

          snapshotsToApply = pendingApplySnapshots;
        }
        return isAnyLayoutChange;
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

    async function fetchAndApplyMetadataUpdates() {
      if (!isOnSubscriptionsPage() || !isDomReady || isApplyingChanges) {
        return;
      }

      const snapshots = await fetchInitialVideos();
      if (!snapshots) {
        return;
      }

      if (isApplyingChanges) {
        return;
      }

      isApplyingChanges = true;
      try {
        lastSnapshot = await detectAndApplyMetadataChanges(lastSnapshot, snapshots);
      } catch {
        // no-op
      } finally {
        isApplyingChanges = false;
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

      if (pollingTimer !== null) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }

      void fetchFreshVideos().finally(() => restartPolling());
    }

    function stopMonitoring() {
      resetLazyUpdates();
      removeEventListener("ytsua-browse-response", handleBrowseResponse);
      removeEventListener("ytsua-subscription-change", handleSubscriptionChange);
      document.removeEventListener("visibilitychange", handlePageFocus);
      cancelBroadcastListener?.();
      cancelBroadcastListener = null;

      if (pollingTimer !== null) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }

      if (metadataPollingTimer !== null) {
        clearInterval(metadataPollingTimer);
        metadataPollingTimer = null;
      }

      if (contentObserver !== null) {
        contentObserver.disconnect();
        contentObserver = null;
      }
    }

    function startMonitoring() {
      addEventListener("ytsua-browse-response", handleBrowseResponse);
      addEventListener("ytsua-subscription-change", handleSubscriptionChange);
      document.addEventListener("visibilitychange", handlePageFocus);
      cancelBroadcastListener = ytsuaChannel.onMessage("subscription-change", handleSubscriptionChange);
      restartPolling();
      metadataPollingTimer = setInterval(() => {
        void fetchAndApplyMetadataUpdates();
      }, 5 * 60 * 1000);
    }

    function applyDomBaseline() {
      isDomReady = true;
      resetLazyUpdates();
      consolidateStandaloneItems();
      lastSnapshot = readDomSnapshot();
      initialBandLayout = captureBandLayout();
      if (pendingApiSnapshots !== null) {
        void applyChanges(pendingApiSnapshots);
        pendingApiSnapshots = null;
      }
    }

    function initializePage() {
      isDomReady = false;
      lastSnapshot.clear();
      initialBandLayout = null;
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
