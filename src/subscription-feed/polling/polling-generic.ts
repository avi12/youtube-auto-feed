import { isGenericContentReady } from "@/subscription-feed/readiness";

import { type HandlerDeps, METADATA_POLL_INTERVAL_MS } from "./polling-state";

// Light monitor for every non-subscription page: just the 10s metadata reconcile + thumbnail watch
// and visibility pause - no 5s feed poll, mirror, band layout, or orphan cleanup.
export function createGenericPageHandlers({ state, getContext }: HandlerDeps) {
  function startLightMonitoring() {
    document.addEventListener("visibilitychange", getContext().handlePageFocus);
    getContext()
      .fetchAndApplyGenericMetadata()
      .catch(() => {});
    state.metadataPollingTimer = setInterval(() => {
      getContext()
        .fetchAndApplyGenericMetadata()
        .catch(() => {});
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
