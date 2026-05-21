import { ytsuaChannel } from "../../messaging";
import { fetchInitialVideos } from "./api/fetch";
import { isInnerTubeBrowseResponse } from "./api/guards";
import { extractApiSectionOrder, parseApiResponse } from "./api/parse";
import { cleanOrphanedGridItems } from "./dom/add/grid";
import {
  type BandLayout,
  captureBandLayout,
  normalizeCollapsedShelfRows,
  normalizeInitialBandLayout
} from "./dom/band-layout";
import { resetLazyUpdates } from "./dom/lazy-update";
import { readDomSnapshot } from "./dom/query";
import { isOnSubscriptionsPage } from "./helpers";
import { isDomContentReady } from "./readiness";
import { detectAndApplyChanges, detectAndApplyMetadataChanges } from "./sync";
import { type VideoSnapshot } from "./types";

interface FeedPayload {
  snapshots: VideoSnapshot[];
  sectionOrder: string[];
}

const INITIAL_POLL_DELAY_MS = 10 * 1000;
const POLL_INTERVAL_MS = 5 * 1000;
const METADATA_POLL_INTERVAL_MS = 10 * 1000;
const PENDING_SNAPSHOT_STALE_MS = 5000;
const ABSENCE_REMOVAL_THRESHOLD = 3;

export function createSubscriptionMonitor() {
  let lastSnapshot = new Map<string, VideoSnapshot>();
  let isDomReady = false;
  let isApplyingChanges = false;
  const pendingApplySnapshots: FeedPayload | null = null;
  let contentObserver: MutationObserver | null = null;
  let orphanCleanupTimer: ReturnType<typeof setInterval> | null = null;
  let pendingApiSnapshots: FeedPayload | null = null;
  let pendingApiSnapshotsTime = 0;
  let pollingDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let pollingTimer: ReturnType<typeof setInterval> | null = null;
  let pageLoadTime = 0;
  let metadataPollingTimer: ReturnType<typeof setInterval> | null = null;
  let cancelBroadcastListener: (() => void) | null = null;
  let initialBandLayout: BandLayout | null = null;
  let pendingRemovals = new Map<string, number>();
  let pendingSectionRemovals = new Map<string, number>();
  let pendingSectionMoves = new Map<string, {
    toSection: string;
    count: number;
  }>();
  let pendingBandMoves = new Map<string, {
    toBandIndex: number;
    count: number;
  }>();
  let apiKnownVideoIds = new Set<string>();

  async function applyChanges({ payload, isInitialLoad = false }: {
    payload: FeedPayload;
    isInitialLoad?: boolean;
  }) {
    if (isApplyingChanges) {
      return false;
    }

    isApplyingChanges = true;
    const shouldNormalizeAfter = isInitialLoad;
    try {
      for (const { videoId } of payload.snapshots) {
        apiKnownVideoIds.add(videoId);
      }

      const confirmedAbsentVideoIds = new Set(
        [...pendingRemovals.entries()]
          .filter(([, count]) => count >= ABSENCE_REMOVAL_THRESHOLD)
          .map(([id]) => id)
      );
      const confirmedAbsentSections = new Set(
        [...pendingSectionRemovals.entries()]
          .filter(([, count]) => count >= ABSENCE_REMOVAL_THRESHOLD)
          .map(([title]) => title)
      );
      const confirmedSectionMoves = new Set(
        [...pendingSectionMoves.entries()]
          .filter(([, { count }]) => count >= ABSENCE_REMOVAL_THRESHOLD)
          .map(([id]) => id)
      );
      const confirmedBandMoves = new Set(
        [...pendingBandMoves.entries()]
          .filter(([, { count }]) => count >= ABSENCE_REMOVAL_THRESHOLD)
          .map(([id]) => id)
      );

      const { isLayoutChange, snapshot, candidateRemovals, candidateSectionRemovals, candidateSectionMoves, candidateBandMoves } = await detectAndApplyChanges({
        previousSnapshot: lastSnapshot,
        freshSnapshots: payload.snapshots,
        bandLayout: initialBandLayout,
        polledSectionOrder: payload.sectionOrder,
        confirmedAbsentVideoIds,
        confirmedAbsentSections,
        confirmedSectionMoves,
        confirmedBandMoves,
        isInitialLoad
      });
      lastSnapshot = snapshot;

      const newPendingRemovals = new Map<string, number>();
      for (const videoId of candidateRemovals) {
        if (apiKnownVideoIds.has(videoId)) {
          newPendingRemovals.set(videoId, (pendingRemovals.get(videoId) ?? 0) + 1);
        }
      }
      pendingRemovals = newPendingRemovals;

      const newPendingSectionRemovals = new Map<string, number>();
      for (const sectionTitle of candidateSectionRemovals) {
        newPendingSectionRemovals.set(sectionTitle, (pendingSectionRemovals.get(sectionTitle) ?? 0) + 1);
      }
      pendingSectionRemovals = newPendingSectionRemovals;

      const newPendingMoves = new Map<string, {
        toSection: string;
        count: number;
      }>();
      for (const { videoId, toSection } of candidateSectionMoves) {
        const existing = pendingSectionMoves.get(videoId);
        const count = (existing?.toSection === toSection ? existing.count : 0) + 1;
        newPendingMoves.set(videoId, {
          toSection,
          count
        });
      }
      pendingSectionMoves = newPendingMoves;

      const newPendingBandMoves = new Map<string, {
        toBandIndex: number;
        count: number;
      }>();
      for (const { videoId, toBandIndex } of candidateBandMoves) {
        const existing = pendingBandMoves.get(videoId);
        const count = (existing?.toBandIndex === toBandIndex ? existing.count : 0) + 1;
        newPendingBandMoves.set(videoId, {
          toBandIndex,
          count
        });
      }
      pendingBandMoves = newPendingBandMoves;

      if (shouldNormalizeAfter) {
        normalizeInitialBandLayout();
        const trimmedVideoIds = await normalizeCollapsedShelfRows();
        lastSnapshot = readDomSnapshot();
        for (const videoId of trimmedVideoIds) {
          lastSnapshot.delete(videoId);
        }
        initialBandLayout = captureBandLayout();
      }

      return isLayoutChange;
    } finally {
      isApplyingChanges = false;
    }
  }

  function handleBrowseResponse(e: Event) {
    if (!isOnSubscriptionsPage() || !(e instanceof CustomEvent)) {
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
    const payload = {
      snapshots,
      sectionOrder
    };
    pendingApiSnapshots = payload;
    pendingApiSnapshotsTime = Date.now();

    if (isDomReady) {
      void applyChanges({ payload });
    }
  }

  async function fetchFreshVideos(isInitialLoad = false) {
    if (!isOnSubscriptionsPage() || !isDomReady) {
      return false;
    }

    const result = await fetchInitialVideos();
    if (!result) {
      return false;
    }

    try {
      return await applyChanges({
        payload: result,
        isInitialLoad
      });
    } catch {
      return false;
    }
  }

  async function fetchAndApplyMetadataUpdates() {
    if (!isOnSubscriptionsPage() || !isDomReady || isApplyingChanges) {
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
    if (!isOnSubscriptionsPage() || !isDomReady) {
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
      if (isDomReady && !isApplyingChanges) {
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
      normalizeInitialBandLayout();
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
    pendingRemovals = new Map();
    pendingSectionRemovals = new Map();
    pendingSectionMoves = new Map();
    pendingBandMoves = new Map();
    apiKnownVideoIds = new Set();

    if (Date.now() - pendingApiSnapshotsTime >= PENDING_SNAPSHOT_STALE_MS) {
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
    if (pollingDelayTimer === null && pollingTimer === null) {
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
