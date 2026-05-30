import { mirrorFromApi } from "../dom/mirror";
import { cleanOrphanedGridItems } from "../dom/orphan-cleanup";
import type { InnerTubeRichGridItem } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";

export { detectAndApplyMetadataChanges } from "./metadata-diff";

export async function detectAndApplyChanges({
  freshSnapshots,
  apiContents
}: {
  freshSnapshots: Prettify<VideoSnapshot>[];
  apiContents: Prettify<InnerTubeRichGridItem>[];
}) {
  const freshMap = new Map<string, Prettify<VideoSnapshot>>();
  for (const video of freshSnapshots) {
    const existing = freshMap.get(video.videoId);
    const shouldPreferLatestBandEntry = !existing || !existing.sectionTitle;
    if (shouldPreferLatestBandEntry) {
      freshMap.set(video.videoId, video);
    }
  }

  await mirrorFromApi({ apiContents });
  cleanOrphanedGridItems();

  return {
    snapshot: freshMap
  };
}
