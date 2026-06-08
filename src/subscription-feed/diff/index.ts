import { mirrorFromApi } from "../dom/mirror";
import { cleanOrphanedGridItems } from "../dom/orphan-cleanup";
import type { InnerTubeRichGridItem } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";
import { detectAndApplyMetadataChanges, withStickyWatchProgress } from "./metadata-diff";

export { detectAndApplyMetadataChanges } from "./metadata-diff";

type DetectAndApplyChangesParams = Prettify<{
  freshSnapshots: Prettify<VideoSnapshot>[];
  apiContents: Prettify<InnerTubeRichGridItem>[];
  previousSnapshot: Map<string, Prettify<VideoSnapshot>>;
}>;

export async function detectAndApplyChanges({
  freshSnapshots,
  apiContents,
  previousSnapshot
}: DetectAndApplyChangesParams) {
  const freshMap = new Map<string, Prettify<VideoSnapshot>>();
  for (const video of freshSnapshots) {
    const existing = freshMap.get(video.videoId);
    const shouldPreferLatestBandEntry = !existing || !existing.sectionTitle;
    if (shouldPreferLatestBandEntry) {
      freshMap.set(
        video.videoId, withStickyWatchProgress({
          fresh: video,
          previous: previousSnapshot.get(video.videoId)
        })
      );
    }
  }

  // Metadata diff runs first so title/status/progress changes on a structural poll still patch
  // the DOM - otherwise changes between the 5s and 10s cadences would be silently absorbed.
  detectAndApplyMetadataChanges({
    previousSnapshot,
    freshSnapshots
  });

  await mirrorFromApi({ apiContents });
  cleanOrphanedGridItems();

  return {
    snapshot: freshMap
  };
}
