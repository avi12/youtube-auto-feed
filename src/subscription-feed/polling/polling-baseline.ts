import { normalizeCollapsedShelfRows } from "../dom/band/band-layout";
import { resetLazyUpdates } from "../dom/lazy/lazy-update";
import { isDomContentReady } from "../readiness";
import { type MonitorContext, PENDING_SNAPSHOT_STALE_MS, rebuildBaselineFromDom } from "./polling-state";

export function createBaselineHandlers(context: MonitorContext) {
  const { state } = context;

  async function applyDomBaseline() {
    state.isDomReady = true;
    state.pageLoadTime = Date.now();
    resetLazyUpdates();
    rebuildBaselineFromDom({
      state,
      trimmedVideoIds: await normalizeCollapsedShelfRows()
    });

    if (state.pendingApiSnapshots !== null) {
      const pending = state.pendingApiSnapshots;
      state.pendingApiSnapshots = null;
      await context.applyChanges({
        payload: pending,
        isInitialLoad: false
      });
      rebuildBaselineFromDom({
        state,
        trimmedVideoIds: await normalizeCollapsedShelfRows()
      });
    }
  }

  function initializePage() {
    state.isDomReady = false;
    state.lastSnapshot.clear();
    state.initialBandLayout = null;

    const isPendingPayloadFresh = Date.now() - state.pendingApiSnapshotsTime < PENDING_SNAPSHOT_STALE_MS;
    if (!isPendingPayloadFresh) {
      state.pendingApiSnapshots = null;
    }

    if (isDomContentReady()) {
      applyDomBaseline().catch(() => {});
      return;
    }

    state.contentObserver = new MutationObserver(() => {
      if (isDomContentReady()) {
        state.contentObserver?.disconnect();
        state.contentObserver = null;
        applyDomBaseline().catch(() => {});
      }
    });
    state.contentObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  return {
    applyDomBaseline,
    initializePage
  };
}
