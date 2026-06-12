import { cleanOrphanedGridItems } from "../dom/cleanup/orphan-cleanup";
import { mirrorFromApi } from "../dom/mirror/mirror";
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
    const isLatestBandEntryPreferred = !existing || !existing.sectionTitle;
    if (!isLatestBandEntryPreferred) {
      continue;
    }

    freshMap.set(
      video.videoId, withStickyWatchProgress({
        fresh: video,
        previous: previousSnapshot.get(video.videoId)
      })
    );
  }

  // Runs before the mirror so metadata changes on a structural poll patch the DOM instead of being absorbed.
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
