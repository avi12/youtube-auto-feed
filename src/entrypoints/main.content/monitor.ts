import { ytsuaChannel } from "../../messaging";
import { fetchInitialVideos } from "./api/fetch";
import { isInnerTubeBrowseResponse } from "./api/guards";
import { extractApiSectionOrder, parseApiResponse } from "./api/parse";
import { type BandLayout, captureBandLayout, consolidateStandaloneItems } from "./dom/band-layout";
import { resetLazyUpdates } from "./dom/lazy-update";
import { readDomSnapshot } from "./dom/query";
import { isOnSubscriptionsPage } from "./helpers";
import { isDomContentReady } from "./readiness";
import { detectAndApplyChanges, detectAndApplyMetadataChanges } from "./sync";
import { type VideoSnapshot } from "./types";

const POLL_INTERVAL_MS = 60 * 60 * 1000;
const METADATA_POLL_INTERVAL_MS = 5 * 60 * 1000;
const PENDING_SNAPSHOT_STALE_MS = 5000;
const ABSENCE_REMOVAL_THRESHOLD = 3;

export function createSubscriptionMonitor() {
  let lastSnapshot = new Map<string, VideoSnapshot>();
  let isDomReady = false;
  let isApplyingChanges = false;
  let pendingApplySnapshots: { snapshots: VideoSnapshot[]; sectionOrder: string[] } | null = null;
  let contentObserver: MutationObserver | null = null;
  let pendingApiSnapshots: { snapshots: VideoSnapshot[]; sectionOrder: string[] } | null = null;
  let pendingApiSnapshotsTime = 0;
  let pollingTimer: ReturnType<typeof setInterval> | null = null;
  let metadataPollingTimer: ReturnType<typeof setInterval> | null = null;
  let cancelBroadcastListener: (() => void) | null = null;
  let initialBandLayout: BandLayout | null = null;
  let pendingRemovals = new Map<string, number>();
  let pendingSectionRemovals = new Map<string, number>();
  let pendingSectionMoves = new Map<string, { toSection: string; count: number }>();

  async function applyChanges(payload: { snapshots: VideoSnapshot[]; sectionOrder: string[] }) {
    if (isApplyingChanges) {
      pendingApplySnapshots = payload;
      return false;
    }

    isApplyingChanges = true;
    try {
      let payloadToApply: { snapshots: VideoSnapshot[]; sectionOrder: string[] } | null = payload;
      let isAnyLayoutChange = false;
      const frozenPendingRemovals = pendingRemovals;
      const frozenPendingSectionRemovals = pendingSectionRemovals;
      const frozenPendingMoves = pendingSectionMoves;
      const confirmedAbsentVideoIds = new Set(
        [...frozenPendingRemovals.entries()]
          .filter(([, count]) => count >= ABSENCE_REMOVAL_THRESHOLD)
          .map(([id]) => id)
      );
      const confirmedAbsentSections = new Set(
        [...frozenPendingSectionRemovals.entries()]
          .filter(([, count]) => count >= ABSENCE_REMOVAL_THRESHOLD)
          .map(([title]) => title)
      );
      const confirmedSectionMoves = new Set(
        [...frozenPendingMoves.entries()]
          .filter(([, { count }]) => count >= ABSENCE_REMOVAL_THRESHOLD)
          .map(([id]) => id)
      );
      let latestCandidateRemovals: string[] = [];
      let latestCandidateSectionRemovals: string[] = [];
      let latestCandidateSectionMoves: { videoId: string; toSection: string }[] = [];
      while (payloadToApply !== null) {
        pendingApplySnapshots = null;
        const { isLayoutChange, snapshot, candidateRemovals, candidateSectionRemovals, candidateSectionMoves } = await detectAndApplyChanges(
          lastSnapshot,
          payloadToApply.snapshots,
          initialBandLayout,
          payloadToApply.sectionOrder,
          confirmedAbsentVideoIds,
          confirmedAbsentSections,
          confirmedSectionMoves
        );
        lastSnapshot = snapshot;
        latestCandidateRemovals = candidateRemovals;
        latestCandidateSectionRemovals = candidateSectionRemovals;
        latestCandidateSectionMoves = candidateSectionMoves;

        if (isLayoutChange) {
          isAnyLayoutChange = true;
          initialBandLayout = captureBandLayout();
        }

        payloadToApply = pendingApplySnapshots;
      }
      const newPendingRemovals = new Map<string, number>();
      for (const videoId of latestCandidateRemovals) {
        newPendingRemovals.set(videoId, (frozenPendingRemovals.get(videoId) ?? 0) + 1);
      }
      pendingRemovals = newPendingRemovals;
      const newPendingSectionRemovals = new Map<string, number>();
      for (const sectionTitle of latestCandidateSectionRemovals) {
        newPendingSectionRemovals.set(sectionTitle, (frozenPendingSectionRemovals.get(sectionTitle) ?? 0) + 1);
      }
      pendingSectionRemovals = newPendingSectionRemovals;
      const newPendingMoves = new Map<string, { toSection: string; count: number }>();
      for (const { videoId, toSection } of latestCandidateSectionMoves) {
        const existing = frozenPendingMoves.get(videoId);
        const count = (existing?.toSection === toSection ? existing.count : 0) + 1;
        newPendingMoves.set(videoId, { toSection, count });
      }
      pendingSectionMoves = newPendingMoves;
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

    const sectionOrder = extractApiSectionOrder(event.detail);
    const payload = { snapshots, sectionOrder };
    pendingApiSnapshots = payload;
    pendingApiSnapshotsTime = Date.now();

    if (isDomReady) {
      void applyChanges(payload);
    }
  }

  async function fetchFreshVideos() {
    if (!isOnSubscriptionsPage() || !isDomReady) {
      return false;
    }

    const result = await fetchInitialVideos();
    if (!result) {
      return false;
    }

    try {
      return await applyChanges(result);
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
      lastSnapshot = await detectAndApplyMetadataChanges(lastSnapshot, result.snapshots);
    } catch {} finally {
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
    }, POLL_INTERVAL_MS);
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

  function startMonitoring() {
    addEventListener("ytsua-browse-response", handleBrowseResponse);
    addEventListener("ytsua-subscription-change", handleSubscriptionChange);
    document.addEventListener("visibilitychange", handlePageFocus);
    cancelBroadcastListener = ytsuaChannel.onMessage("subscription-change", handleSubscriptionChange);
    restartPolling();
    metadataPollingTimer = setInterval(() => {
      void fetchAndApplyMetadataUpdates();
    }, METADATA_POLL_INTERVAL_MS);
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
    pendingRemovals = new Map();
    pendingSectionRemovals = new Map();
    pendingSectionMoves = new Map();

    if (Date.now() - pendingApiSnapshotsTime >= PENDING_SNAPSHOT_STALE_MS) {
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

  function pausePolling() {
    if (pollingTimer !== null) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  function resumePolling() {
    if (pollingTimer === null) {
      restartPolling();
    }
  }

  return { handleNavigation, pausePolling, resumePolling };
}
