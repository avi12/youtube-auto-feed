import { detectAndApplyMetadataChanges } from "../diff";
import { isOnSubscriptionsPage } from "../utils/subscriptions-page";
import { fetchInitialVideos } from "../youtube-api/fetch";
import { invalidateSubscribedChannelKeys } from "../youtube-api/subscriptions";
import { type MonitorContext, preloadSnapshotThumbnails } from "./polling-state";

export function createFetchHandlers(context: MonitorContext) {
  const { state } = context;

  async function fetchFreshVideos(isInitialLoad = false) {
    const isPollEligible = isOnSubscriptionsPage() && state.isDomReady && state.isEnabled;
    if (!isPollEligible) {
      return false;
    }

    const result = await fetchInitialVideos();
    if (!result) {
      return false;
    }

    preloadSnapshotThumbnails(result.snapshots);

    try {
      const isLayoutChange = await context.applyChanges({
        payload: result,
        isInitialLoad
      });
      return isLayoutChange;
    } catch {
      return false;
    }
  }

  async function fetchAndApplyMetadataUpdates() {
    const isMetadataPollEligible = isOnSubscriptionsPage()
      && state.isDomReady
      && state.isEnabled
      && !state.isApplyingChanges
      && !document.hidden;
    if (!isMetadataPollEligible) {
      return;
    }

    const result = await fetchInitialVideos();
    if (!result) {
      return;
    }

    if (state.isApplyingChanges) {
      return;
    }

    state.isApplyingChanges = true;
    try {
      state.lastSnapshot = await detectAndApplyMetadataChanges({
        previousSnapshot: state.lastSnapshot,
        freshSnapshots: result.snapshots
      });
    } catch {} finally {
      state.isApplyingChanges = false;
    }
  }

  function handleSubscriptionChange() {
    invalidateSubscribedChannelKeys();
    state.isSubscriptionFetchInProgress = true;
    fetchFreshVideos()
      .finally(() => {
        state.isSubscriptionFetchInProgress = false;
      })
      .catch(() => {});
  }

  return {
    fetchFreshVideos,
    fetchAndApplyMetadataUpdates,
    handleSubscriptionChange
  };
}
