import { feedMessenger } from "../shared/feed-messaging";
import { ytafChannel } from "../shared/messaging";
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
// feeds InnerTube responses through here via the feedMessenger "browseResponse" message.

interface FeedPayload {
  snapshots: VideoSnapshot[];
  sectionOrder: string[];
  apiContents: InnerTubeRichGridItem[];
}

type ApplyChangesParams = Prettify<{
  payload: Prettify<FeedPayload>;
  isInitialLoad?: boolean;
}>;

const INITIAL_POLL_DELAY_MS = 10 * 1000;
const POLL_INTERVAL_MS = 5 * 1000;
const METADATA_POLL_INTERVAL_MS = 10 * 1000;
const PENDING_SNAPSHOT_STALE_MS = 5000;

// This factory binds the monitor's mutable lifecycle state (snapshots, timers, flags) to its
// handlers through one closure. Extracting the handlers to satisfy max-lines would mean threading
// that shared state through every call, scattering it and reducing readability - so it stays whole.
// oxlint-disable-next-line max-lines-per-function
export function createSubscriptionMonitor() {
  let lastSnapshot = new Map<string, Prettify<VideoSnapshot>>();
  let isDomReady = false;
  let isEnabled = true;
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

  async function applyChanges({ payload, isInitialLoad = false }: ApplyChangesParams) {
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

  function handleBrowseResponse(response: unknown) {
    if (!isOnSubscriptionsPage()) {
      return;
    }

    if (!isInnerTubeBrowseResponse(response)) {
      return;
    }

    const snapshots = parseApiResponse(response);
    if (snapshots.length === 0) {
      return;
    }

    const sectionOrder = extractApiSectionOrder(response);
    const apiContents = extractApiContents(response);
    const payload = {
      snapshots,
      sectionOrder,
      apiContents
    };
    pendingApiSnapshots = payload;
    pendingApiSnapshotsTime = Date.now();

    const canApplyImmediately = isDomReady && !document.hidden && isEnabled;
    if (canApplyImmediately) {
      applyChanges({ payload }).catch(() => {});
    }
  }

  async function fetchFreshVideos(isInitialLoad = false) {
    const isPollEligible = isOnSubscriptionsPage() && isDomReady && isEnabled;
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
      || !isEnabled
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
    fetchFreshVideos().catch(() => {});
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
      fetchFreshVideos().catch(() => {});
      pollingTimer = setInterval(() => {
        fetchFreshVideos().catch(() => {});
      }, POLL_INTERVAL_MS);
    }, INITIAL_POLL_DELAY_MS);
  }

  function handlePageFocus() {
    const isPageFocusEligible = isOnSubscriptionsPage() && isDomReady;
    if (!isPageFocusEligible) {
      return;
    }

    if (document.hidden || !isEnabled) {
      clearPolling();
      return;
    }

    const isWithinInitialDelay = Date.now() - pageLoadTime < INITIAL_POLL_DELAY_MS;
    if (isWithinInitialDelay) {
      restartPolling();
      return;
    }

    clearPolling();
    fetchFreshVideos().finally(() => restartPolling()).catch(() => {});
  }

  function startMonitoring() {
    document.addEventListener("visibilitychange", handlePageFocus);
    cancelBroadcastListener = ytafChannel.onMessage({
      type: "subscription-change",
      handler: handleSubscriptionChange
    });
    restartPolling();
    metadataPollingTimer = setInterval(() => {
      fetchAndApplyMetadataUpdates().catch(() => {});
    }, METADATA_POLL_INTERVAL_MS);
    orphanCleanupTimer = setInterval(() => {
      const canCleanNow = isDomReady && !isApplyingChanges && isEnabled;
      if (canCleanNow) {
        requestIdleCallback(() => cleanOrphanedGridItems());
      }
    }, 5000);
  }

  function stopMonitoring() {
    resetLazyUpdates();
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
      applyDomBaseline().catch(() => {});
      return;
    }

    contentObserver = new MutationObserver(() => {
      if (isDomContentReady()) {
        contentObserver?.disconnect();
        contentObserver = null;
        applyDomBaseline().catch(() => {});
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

  // Disabling pauses every apply path exactly like a hidden tab; enabling resumes and runs an
  // immediate fetch + sync, as if the tab just regained focus.
  function setEnabled(enabled: boolean) {
    if (enabled === isEnabled) {
      return;
    }

    isEnabled = enabled;

    const isFeedActive = isOnSubscriptionsPage() && isDomReady;
    if (!isFeedActive) {
      return;
    }

    if (!isEnabled) {
      clearPolling();
      return;
    }

    clearPolling();
    fetchFreshVideos().finally(() => restartPolling()).catch(() => {});
  }

  // The interceptor can emit a browse response before any given navigation's startMonitoring runs,
  // so these listeners live for the monitor's whole lifetime (the handlers self-gate on page/DOM
  // state). An always-registered listener also guarantees the messenger send resolves rather than
  // leaking a pending request.
  feedMessenger.onMessage("browseResponse", ({ data }) => handleBrowseResponse(data));
  feedMessenger.onMessage("subscriptionChange", handleSubscriptionChange);

  return {
    handleNavigation,
    pausePolling,
    resumePolling,
    fetchFreshVideos,
    setEnabled
  };
}
