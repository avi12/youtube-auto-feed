import { detectAndApplyMetadataChanges } from "../diff";
import { reconcileVisibleThumbnails, THUMBNAIL_WATCH_INTERVAL_MS } from "../dom/update/thumbnail-content-watch";
import { isOnSubscriptionsPage } from "../utils/subscriptions-page";
import { fetchInitialVideos } from "../youtube-api/fetch";
import { invalidateSubscriptionCache } from "../youtube-api/watch-page-subscription";
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
    } finally {
      state.isApplyingChanges = false;
    }

    await watchServedThumbnailVariants();
  }

  // A/B-tested thumbnails swap the served picture under a stable feed URL, so the URL-keyed metadata
  // diff never sees them. This periodic content check catches those variant swaps on visible tiles.
  async function watchServedThumbnailVariants() {
    const isWatchDue = Date.now() - state.lastThumbnailWatchTime >= THUMBNAIL_WATCH_INTERVAL_MS;
    if (!isWatchDue) {
      return;
    }

    state.lastThumbnailWatchTime = Date.now();
    await reconcileVisibleThumbnails({ contentHashes: state.thumbnailContentHashes }).catch(() => {});
  }

  function handleSubscriptionChange() {
    invalidateSubscriptionCache();
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
