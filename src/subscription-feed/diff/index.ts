import { mirrorFromApi } from "../dom/mirror";
import { cleanOrphanedGridItems } from "../dom/orphan-cleanup";
import type { InnerTubeRichGridItem } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";
import { detectAndApplyMetadataChanges } from "./metadata-diff";

export { detectAndApplyMetadataChanges } from "./metadata-diff";

export async function detectAndApplyChanges({
  freshSnapshots,
  apiContents,
  previousSnapshot
}: {
  freshSnapshots: Prettify<VideoSnapshot>[];
  apiContents: Prettify<InnerTubeRichGridItem>[];
  previousSnapshot: Map<string, Prettify<VideoSnapshot>>;
}) {
  const freshMap = new Map<string, Prettify<VideoSnapshot>>();
  for (const video of freshSnapshots) {
    const existing = freshMap.get(video.videoId);
    const shouldPreferLatestBandEntry = !existing || !existing.sectionTitle;
    if (shouldPreferLatestBandEntry) {
      freshMap.set(video.videoId, video);
    }
  }

  // Metadata diff runs first so watchProgressPercent / title / status flips that arrive on a
  // structural poll still patch the existing DOM. Without this, changes that fall between the 5s
  // structural and the 10s metadata cadence would be silently absorbed into lastSnapshot.
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
