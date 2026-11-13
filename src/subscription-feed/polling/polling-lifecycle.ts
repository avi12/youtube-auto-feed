import { ytafChannel } from "@/shared/messaging";
import { cleanOrphanedGridItems } from "@/subscription-feed/dom/cleanup/orphan-cleanup";
import { resetLazyUpdates } from "@/subscription-feed/dom/lazy/lazy-update";
import { isOnSubscriptionsPage, isOnVideoPage } from "@/subscription-feed/utils/subscriptions-page";

import { METADATA_POLL_INTERVAL_MS, type HandlerDeps, ORPHAN_CLEANUP_INTERVAL_MS } from "./polling-state";

export function createLifecycleHandlers({ state, getContext }: HandlerDeps) {

  function startMonitoring() {
    document.addEventListener("visibilitychange", getContext().handlePageFocus);
    state.cancelBroadcastListener = ytafChannel.onMessage({
      type: "subscription-change",
      handler: getContext().handleSubscriptionChange
    });
    getContext().restartPolling();
    state.metadataPollingTimer = setInterval(() => {
      getContext().fetchAndApplyMetadataUpdates().catch(() => {});
    }, METADATA_POLL_INTERVAL_MS);
    state.orphanCleanupTimer = setInterval(() => {
      const isCleanableNow = state.isDomReady && !state.isApplyingChanges && state.isEnabled;
      if (isCleanableNow) {
        requestIdleCallback(() => cleanOrphanedGridItems());
      }
    }, ORPHAN_CLEANUP_INTERVAL_MS);
  }

  function stopMonitoring() {
    if (state.monitorMode === "video") {
      getContext().stopVideoMonitoring();
    }

    state.monitorMode = null;
    resetLazyUpdates();
    document.removeEventListener("visibilitychange", getContext().handlePageFocus);
    state.cancelBroadcastListener?.();
    state.cancelBroadcastListener = null;

    getContext().clearPolling();

    if (state.metadataPollingTimer !== null) {
      clearInterval(state.metadataPollingTimer);
      state.metadataPollingTimer = null;
    }

    if (state.contentObserver !== null) {
      state.contentObserver.disconnect();
      state.contentObserver = null;
    }

    if (state.orphanCleanupTimer !== null) {
      clearInterval(state.orphanCleanupTimer);
      state.orphanCleanupTimer = null;
    }
  }

  function handleNavigation() {
    stopMonitoring();

    if (isOnSubscriptionsPage()) {
      state.monitorMode = "feed";
      getContext().initializePage();
      startMonitoring();
      return;
    }

    // Refetching a watch page every poll gets the video soft-blocked for the session, so the light
    // updater stays off video pages; the opt-in video monitor reads them from InnerTube instead.
    if (isOnVideoPage()) {
      getContext().initializeVideoPage();
      return;
    }

    state.monitorMode = "light";
    getContext().initializeGenericPage();
  }

  function setEnabled(isNowEnabled: boolean) {
    if (isNowEnabled === state.isEnabled) {
      return;
    }

    state.isEnabled = isNowEnabled;

    const isFeedActive = isOnSubscriptionsPage() && state.isDomReady;
    if (!isFeedActive) {
      return;
    }

    if (!state.isEnabled) {
      getContext().clearPolling();
      return;
    }

    getContext().clearPolling();
    getContext()
      .fetchFreshVideos()
      .finally(() => getContext().restartPolling())
      .catch(() => {});
  }

  return {
    startMonitoring,
    stopMonitoring,
    handleNavigation,
    setEnabled
  };
}
