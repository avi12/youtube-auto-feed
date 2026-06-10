import { detectAndApplyChanges } from "../diff";
import { captureBandLayout, normalizeCollapsedShelfRows } from "../dom/band/band-layout";
import { isOnSubscriptionsPage } from "../utils/subscriptions-page";
import { isInnerTubeBrowseResponse } from "../youtube-api/guards";
import { extractApiContents, extractApiSectionOrder, parseApiResponse } from "../youtube-api/parse-response";
import {
  type ApplyChangesParams,
  type MonitorContext,
  preloadSnapshotThumbnails,
  rebuildBaselineFromDom
} from "./polling-state";

export function createApplyHandlers(context: MonitorContext) {
  const { state } = context;

  async function applyChanges({ payload, isInitialLoad = false }: ApplyChangesParams) {
    if (state.isApplyingChanges) {
      return false;
    }

    state.isApplyingChanges = true;
    try {
      const result = await detectAndApplyChanges({
        freshSnapshots: payload.snapshots,
        apiContents: payload.apiContents,
        previousSnapshot: state.lastSnapshot
      });
      state.lastSnapshot = result.snapshot;

      if (!isInitialLoad && state.initialBandLayout !== null) {
        const updatedLayout = captureBandLayout();
        if (updatedLayout !== null) {
          state.initialBandLayout = updatedLayout;
        }
      }

      if (isInitialLoad) {
        await rebuildBaselineFromDom(state, await normalizeCollapsedShelfRows());
      }

      return true;
    } finally {
      state.isApplyingChanges = false;
    }
  }

  function handleBrowseResponse(response: unknown) {
    if (!isOnSubscriptionsPage()) {
      return;
    }

    if (!isInnerTubeBrowseResponse(response)) {
      return;
    }

    const snapshots = parseApiResponse(response);
    if (snapshots.length === 0) {
      return;
    }

    preloadSnapshotThumbnails(snapshots);

    const sectionOrder = extractApiSectionOrder(response);
    const apiContents = extractApiContents(response);
    const payload = {
      snapshots,
      sectionOrder,
      apiContents
    };
    state.pendingApiSnapshots = payload;
    state.pendingApiSnapshotsTime = Date.now();

    const canApplyImmediately =
      state.isDomReady && !document.hidden && state.isEnabled && !state.isSubscriptionFetchInProgress;
    if (canApplyImmediately) {
      applyChanges({ payload }).catch(() => {});
    }
  }

  return {
    applyChanges,
    handleBrowseResponse
  };
}
