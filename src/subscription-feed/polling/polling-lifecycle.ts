import { ytafChannel } from "../../shared/messaging";
import { cleanOrphanedGridItems } from "../dom/cleanup/orphan-cleanup";
import { resetLazyUpdates } from "../dom/lazy/lazy-update";
import { isOnSubscriptionsPage } from "../utils/subscriptions-page";
import { METADATA_POLL_INTERVAL_MS, type MonitorContext, ORPHAN_CLEANUP_INTERVAL_MS } from "./polling-state";

export function createLifecycleHandlers(context: MonitorContext) {
  const { state } = context;

  function startMonitoring() {
    document.addEventListener("visibilitychange", context.handlePageFocus);
    state.cancelBroadcastListener = ytafChannel.onMessage({
      type: "subscription-change",
      handler: context.handleSubscriptionChange
    });
    context.restartPolling();
    state.metadataPollingTimer = setInterval(() => {
      context.fetchAndApplyMetadataUpdates().catch(() => {});
    }, METADATA_POLL_INTERVAL_MS);
    state.orphanCleanupTimer = setInterval(() => {
      const canCleanNow = state.isDomReady && !state.isApplyingChanges && state.isEnabled;
      if (canCleanNow) {
        requestIdleCallback(() => cleanOrphanedGridItems());
      }
    }, ORPHAN_CLEANUP_INTERVAL_MS);
  }

  function stopMonitoring() {
    resetLazyUpdates();
    document.removeEventListener("visibilitychange", context.handlePageFocus);
    state.cancelBroadcastListener?.();
    state.cancelBroadcastListener = null;

    context.clearPolling();

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
      context.initializePage();
      startMonitoring();
    }
  }

  function setEnabled(enabled: boolean) {
    if (enabled === state.isEnabled) {
      return;
    }

    state.isEnabled = enabled;

    const isFeedActive = isOnSubscriptionsPage() && state.isDomReady;
    if (!isFeedActive) {
      return;
    }

    if (!state.isEnabled) {
      context.clearPolling();
      return;
    }

    context.clearPolling();
    context.fetchFreshVideos().finally(() => context.restartPolling()).catch(() => {});
  }

  return {
    startMonitoring,
    stopMonitoring,
    handleNavigation,
    setEnabled
  };
}
