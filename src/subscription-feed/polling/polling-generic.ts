import { isGenericContentReady } from "../readiness";
import { METADATA_POLL_INTERVAL_MS, type MonitorContext } from "./polling-state";

// Light monitor for every non-subscription page: just the 10s metadata reconcile + thumbnail watch
// and visibility pause - no 5s feed poll, mirror, band layout, or orphan cleanup.
export function createGenericPageHandlers(context: MonitorContext) {
  const { state } = context;

  function startLightMonitoring() {
    document.addEventListener("visibilitychange", context.handlePageFocus);
    context.fetchAndApplyGenericMetadata().catch(() => {});
    state.metadataPollingTimer = setInterval(() => {
      context.fetchAndApplyGenericMetadata().catch(() => {});
    }, METADATA_POLL_INTERVAL_MS);
  }

  function initializeGenericPage() {
    state.isDomReady = false;
    state.lastSnapshot.clear();

    if (isGenericContentReady()) {
      state.isDomReady = true;
      startLightMonitoring();
      return;
    }

    state.contentObserver = new MutationObserver(() => {
      if (isGenericContentReady()) {
        state.contentObserver?.disconnect();
        state.contentObserver = null;
        state.isDomReady = true;
        startLightMonitoring();
      }
    });
    state.contentObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  return { initializeGenericPage };
}
