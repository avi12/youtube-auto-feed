import { cleanOrphanedGridItems } from "@/subscription-feed/dom/cleanup/orphan-cleanup";
import { mirrorFromApi } from "@/subscription-feed/dom/mirror/mirror";
import type { InnerTubeRichGridItem } from "@/subscription-feed/types/innertube";
import type { Prettify } from "@/subscription-feed/types/prettify";
import type { VideoSnapshot } from "@/subscription-feed/types/video";

import { detectAndApplyMetadataChanges, withStickyWatchProgress } from "./metadata-diff";

export { applyGenericMetadataUpdates, detectAndApplyMetadataChanges } from "./metadata-diff";

type DetectAndApplyChangesParams = Prettify<{
  freshSnapshots: Prettify<VideoSnapshot>[];
  apiContents: Prettify<InnerTubeRichGridItem>[];
  hiddenVideoIds: Set<string>;
  previousSnapshot: Map<string, Prettify<VideoSnapshot>>;
  isInitialLoad: boolean;
}>;

export async function detectAndApplyChanges({
  freshSnapshots,
  apiContents,
  hiddenVideoIds,
  previousSnapshot,
  isInitialLoad
}: DetectAndApplyChangesParams) {
  const freshMap = new Map<string, Prettify<VideoSnapshot>>();
  for (const video of freshSnapshots) {
    const existing = freshMap.get(video.videoId);
    const isLatestBandEntryPreferred = !existing || !existing.sectionTitle;
    if (!isLatestBandEntryPreferred) {
      continue;
    }

    freshMap.set(
      video.videoId,
      withStickyWatchProgress({
        fresh: video,
        previous: previousSnapshot.get(video.videoId)
      })
    );
  }

  // Runs before the mirror so metadata changes on a structural poll patch the DOM instead of being absorbed.
  const { deferredVideoIds } = detectAndApplyMetadataChanges({
    previousSnapshot,
    freshSnapshots
  });
  for (const videoId of deferredVideoIds) {
    const previous = previousSnapshot.get(videoId);
    if (previous) {
      freshMap.set(videoId, previous);
    }
  }

  await mirrorFromApi({
    apiContents,
    hiddenVideoIds,
    isInitialLoad
  });
  cleanOrphanedGridItems();

  return {
    snapshot: freshMap
  };
}
