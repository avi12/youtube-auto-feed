import { ytsuaChannel } from "../shared/messaging";
import { detectAndApplyChanges, detectAndApplyMetadataChanges } from "./diff";
import { type BandLayout, captureBandLayout, normalizeCollapsedShelfRows } from "./dom/band-layout";
import { resetLazyUpdates } from "./dom/lazy-update";
import { cleanOrphanedGridItems } from "./dom/orphan-cleanup";
import { readDomSnapshot } from "./dom/query";
import { isDomContentReady } from "./readiness";
import type { InnerTubeRichGridItem } from "./types/innertube";
import type { Prettify } from "./types/prettify";
import type { VideoSnapshot } from "./types/video";
import { isOnSubscriptionsPage } from "./utils/subscriptions-page";
import { fetchInitialVideos } from "./youtube-api/fetch";
import { isInnerTubeBrowseResponse } from "./youtube-api/guards";
import { extractApiContents, extractApiSectionOrder, parseApiResponse } from "./youtube-api/parse-response";

// Owns the polling lifecycle: the 5s full-feed poll, the 10s metadata-only poll, the orphan
// cleanup tick, and the navigation/visibility hooks that pause polling when the tab is hidden
// or the user has navigated away from /feed/subscriptions. The fetch-interceptor entrypoint
// feeds InnerTube responses through here via the "ytsua-browse-response" CustomEvent.

interface FeedPayload {
  snapshots: VideoSnapshot[];
  sectionOrder: string[];
  apiContents: InnerTubeRichGridItem[];
}

const INITIAL_POLL_DELAY_MS = 10 * 1000;
const POLL_INTERVAL_MS = 5 * 1000;
const METADATA_POLL_INTERVAL_MS = 10 * 1000;
const PENDING_SNAPSHOT_STALE_MS = 5000;

export function createSubscriptionMonitor() {
  let lastSnapshot = new Map<string, Prettify<VideoSnapshot>>();
  let isDomReady = false;
  let isApplyingChanges = false;
  let contentObserver: MutationObserver | null = null;
  let orphanCleanupTimer: ReturnType<typeof setInterval> | null = null;
  let pendingApiSnapshots: Prettify<FeedPayload> | null = null;
  let pendingApiSnapshotsTime = 0;
  let pollingDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let pollingTimer: ReturnType<typeof setInterval> | null = null;
  let pageLoadTime = 0;
  let metadataPollingTimer: ReturnType<typeof setInterval> | null = null;
  let cancelBroadcastListener: (() => void) | null = null;
  let initialBandLayout: Prettify<BandLayout> | null = null;

  async function applyChanges({ payload, isInitialLoad = false }: {
    payload: Prettify<FeedPayload>;
    isInitialLoad?: boolean;
  }) {
    if (isApplyingChanges) {
      return false;
    }

    isApplyingChanges = true;
    const shouldNormalizeAfter = isInitialLoad;
    try {
      const result = await detectAndApplyChanges({
        freshSnapshots: payload.snapshots,
        apiContents: payload.apiContents,
        previousSnapshot: lastSnapshot
      });
      lastSnapshot = result.snapshot;

      // The mirror rewrites data.contents on every poll; re-capture band layout afterwards
      // so any cached layout snapshot reflects the now-current shape of the grid.
      if (!isInitialLoad && initialBandLayout !== null) {
        const updatedLayout = captureBandLayout();
        if (updatedLayout !== null) {
          initialBandLayout = updatedLayout;
        }
      }

      if (shouldNormalizeAfter) {
        const trimmedVideoIds = await normalizeCollapsedShelfRows();
        lastSnapshot = readDomSnapshot();
        for (const videoId of trimmedVideoIds) {
          lastSnapshot.delete(videoId);
        }
        initialBandLayout = captureBandLayout();
      }

      return true;
    } finally {
      isApplyingChanges = false;
    }
  }

  function handleBrowseResponse(e: Event) {
    const isApplicableBrowseEvent = isOnSubscriptionsPage() && e instanceof CustomEvent;
    if (!isApplicableBrowseEvent) {
      return;
    }

    if (!isInnerTubeBrowseResponse(e.detail)) {
      return;
    }

    const snapshots = parseApiResponse(e.detail);
    if (snapshots.length === 0) {
      return;
    }

    const sectionOrder = extractApiSectionOrder(e.detail);
    const apiContents = extractApiContents(e.detail);
    const payload = {
      snapshots,
      sectionOrder,
      apiContents
    };
    pendingApiSnapshots = payload;
    pendingApiSnapshotsTime = Date.now();

    const canApplyImmediately = isDomReady && !document.hidden;
    if (canApplyImmediately) {
      void applyChanges({ payload });
    }
  }

  async function fetchFreshVideos(isInitialLoad = false) {
    const isPollEligible = isOnSubscriptionsPage() && isDomReady;
    if (!isPollEligible) {
      return false;
    }

    const result = await fetchInitialVideos();
    if (!result) {
      return false;
    }

    try {
      const isLayoutChange = await applyChanges({
        payload: result,
        isInitialLoad
      });
      return isLayoutChange;
    } catch {
      return false;
    }
  }

  async function fetchAndApplyMetadataUpdates() {
    const isMetadataPollSkippable = !isOnSubscriptionsPage()
      || !isDomReady
      || isApplyingChanges
      || document.hidden;
    if (isMetadataPollSkippable) {
      return;
    }

    const result = await fetchInitialVideos();
    if (!result) {
      return;
    }

    if (isApplyingChanges) {
      return;
    }

    isApplyingChanges = true;
    try {
      lastSnapshot = await detectAndApplyMetadataChanges({
        previousSnapshot: lastSnapshot,
        freshSnapshots: result.snapshots
      });
    } catch {} finally {
      isApplyingChanges = false;
    }
  }

  function handleSubscriptionChange() {
    void fetchFreshVideos();
  }

  function clearPolling() {
    if (pollingDelayTimer !== null) {
      clearTimeout(pollingDelayTimer);
      pollingDelayTimer = null;
    }

    if (pollingTimer !== null) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  function restartPolling() {
    clearPolling();
    pollingDelayTimer = setTimeout(() => {
      pollingDelayTimer = null;
      void fetchFreshVideos();
      pollingTimer = setInterval(() => {
        void fetchFreshVideos();
      }, POLL_INTERVAL_MS);
    }, INITIAL_POLL_DELAY_MS);
  }

  function handlePageFocus() {
    const isPageFocusEligible = isOnSubscriptionsPage() && isDomReady;
    if (!isPageFocusEligible) {
      return;
    }

    if (document.hidden) {
      clearPolling();
      return;
    }

    const isWithinInitialDelay = Date.now() - pageLoadTime < INITIAL_POLL_DELAY_MS;
    if (isWithinInitialDelay) {
      restartPolling();
      return;
    }

    clearPolling();
    void fetchFreshVideos().finally(() => restartPolling());
  }

  function startMonitoring() {
    addEventListener("ytsua-browse-response", handleBrowseResponse);
    addEventListener("ytsua-subscription-change", handleSubscriptionChange);
    document.addEventListener("visibilitychange", handlePageFocus);
    cancelBroadcastListener = ytsuaChannel.onMessage({
      type: "subscription-change",
      handler: handleSubscriptionChange
    });
    restartPolling();
    metadataPollingTimer = setInterval(() => {
      void fetchAndApplyMetadataUpdates();
    }, METADATA_POLL_INTERVAL_MS);
    orphanCleanupTimer = setInterval(() => {
      const canCleanNow = isDomReady && !isApplyingChanges;
      if (canCleanNow) {
        requestIdleCallback(() => cleanOrphanedGridItems());
      }
    }, 5000);
  }

  function stopMonitoring() {
    resetLazyUpdates();
    removeEventListener("ytsua-browse-response", handleBrowseResponse);
    removeEventListener("ytsua-subscription-change", handleSubscriptionChange);
    document.removeEventListener("visibilitychange", handlePageFocus);
    cancelBroadcastListener?.();
    cancelBroadcastListener = null;

    clearPolling();

    if (metadataPollingTimer !== null) {
      clearInterval(metadataPollingTimer);
      metadataPollingTimer = null;
    }

    if (contentObserver !== null) {
      contentObserver.disconnect();
      contentObserver = null;
    }

    if (orphanCleanupTimer !== null) {
      clearInterval(orphanCleanupTimer);
      orphanCleanupTimer = null;
    }
  }

  async function applyDomBaseline() {
    isDomReady = true;
    pageLoadTime = Date.now();
    resetLazyUpdates();
    const trimmedVideoIds = await normalizeCollapsedShelfRows();
    lastSnapshot = readDomSnapshot();
    for (const videoId of trimmedVideoIds) {
      lastSnapshot.delete(videoId);
    }
    initialBandLayout = captureBandLayout();

    if (pendingApiSnapshots !== null) {
      const pending = pendingApiSnapshots;
      pendingApiSnapshots = null;
      await applyChanges({
        payload: pending,
        isInitialLoad: false
      });
      const trimmedAfterApply = await normalizeCollapsedShelfRows();
      lastSnapshot = readDomSnapshot();
      for (const videoId of trimmedAfterApply) {
        lastSnapshot.delete(videoId);
      }
      initialBandLayout = captureBandLayout();
    }
  }

  function initializePage() {
    isDomReady = false;
    lastSnapshot.clear();
    initialBandLayout = null;

    // Discard a pending response if the SPA navigation took long enough that it likely belongs to a prior page state.
    const isPendingPayloadFresh = Date.now() - pendingApiSnapshotsTime < PENDING_SNAPSHOT_STALE_MS;
    if (!isPendingPayloadFresh) {
      pendingApiSnapshots = null;
    }

    if (isDomContentReady()) {
      void applyDomBaseline();
      return;
    }

    contentObserver = new MutationObserver(() => {
      if (isDomContentReady()) {
        contentObserver?.disconnect();
        contentObserver = null;
        void applyDomBaseline();
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

  function pausePolling() {
    clearPolling();
  }

  function resumePolling() {
    const isPollingIdle = pollingDelayTimer === null && pollingTimer === null;
    if (isPollingIdle) {
      restartPolling();
    }
  }

  return {
    handleNavigation,
    pausePolling,
    resumePolling,
    fetchFreshVideos
  };
}
