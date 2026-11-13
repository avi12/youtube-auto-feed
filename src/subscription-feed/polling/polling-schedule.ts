import { isOnSubscriptionsPage } from "@/subscription-feed/utils/subscriptions-page";

import { type HandlerDeps, INITIAL_POLL_DELAY_MS, POLL_INTERVAL_MS } from "./polling-state";

export function createScheduleHandlers({ state, getContext }: HandlerDeps) {
  function clearPolling() {
    if (state.pollingDelayTimer !== null) {
      clearTimeout(state.pollingDelayTimer);
      state.pollingDelayTimer = null;
    }

    if (state.pollingTimer !== null) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }
  }

  function restartPolling() {
    clearPolling();
    // Wait out the initial delay, then poll the full feed every 5s.
    state.pollingDelayTimer = setTimeout(() => {
      state.pollingDelayTimer = null;
      getContext()
        .fetchFreshVideos()
        .catch(() => {});
      state.pollingTimer = setInterval(() => {
        getContext()
          .fetchFreshVideos()
          .catch(() => {});
      }, POLL_INTERVAL_MS);
    }, INITIAL_POLL_DELAY_MS);
  }

  function handlePageFocus() {
    const isPageFocusEligible = isOnSubscriptionsPage() && state.isDomReady;
    if (!isPageFocusEligible) {
      return;
    }

    const isPollingPaused = document.hidden || !state.isEnabled;
    if (isPollingPaused) {
      clearPolling();
      return;
    }

    const isWithinInitialDelay = Date.now() - state.pageLoadTime < INITIAL_POLL_DELAY_MS;
    if (isWithinInitialDelay) {
      restartPolling();
      return;
    }

    clearPolling();
    getContext()
      .fetchFreshVideos()
      .finally(() => restartPolling())
      .catch(() => {});
  }

  function pausePolling() {
    clearPolling();
  }

  function resumePolling() {
    const isPollingIdle = state.pollingDelayTimer === null && state.pollingTimer === null;
    if (isPollingIdle) {
      restartPolling();
    }
  }

  return {
    clearPolling,
    restartPolling,
    handlePageFocus,
    pausePolling,
    resumePolling
  };
}
