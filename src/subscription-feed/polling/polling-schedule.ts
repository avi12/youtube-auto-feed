import { isOnSubscriptionsPage } from "../utils/subscriptions-page";
import { INITIAL_POLL_DELAY_MS, type MonitorContext, POLL_INTERVAL_MS } from "./polling-state";

export function createScheduleHandlers(context: MonitorContext) {
  const { state } = context;

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
      context.fetchFreshVideos().catch(() => {});
      state.pollingTimer = setInterval(() => {
        context.fetchFreshVideos().catch(() => {});
      }, POLL_INTERVAL_MS);
    }, INITIAL_POLL_DELAY_MS);
  }

  function handlePageFocus() {
    const isPageFocusEligible = isOnSubscriptionsPage() && state.isDomReady;
    if (!isPageFocusEligible) {
      return;
    }

    if (document.hidden || !state.isEnabled) {
      clearPolling();
      return;
    }

    const isWithinInitialDelay = Date.now() - state.pageLoadTime < INITIAL_POLL_DELAY_MS;
    if (isWithinInitialDelay) {
      restartPolling();
      return;
    }

    clearPolling();
    context.fetchFreshVideos().finally(() => restartPolling()).catch(() => {});
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
