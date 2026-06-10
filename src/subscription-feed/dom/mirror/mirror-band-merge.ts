import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";

export type InlineBandEntry = {
  videoId: string;
  item: Prettify<InnerTubeRichGridItem>;
};

type MergeBandParams = Prettify<{
  currentBand: InlineBandEntry[];
  apiBand: InlineBandEntry[];
  lcs: string[];
  apiBandIds: Set<string>;
  apiItemById: Map<string, Prettify<InnerTubeRichGridItem>>;
  retainedDroppedIds: Set<string>;
}>;

export function mergeBand({
  currentBand,
  apiBand,
  lcs: commonSubsequence,
  apiBandIds,
  apiItemById,
  retainedDroppedIds
}: MergeBandParams) {
  const currentItemById = new Map(currentBand.map(entry => [entry.videoId, entry.item]));
  const mergedBand: Prettify<InnerTubeRichGridItem>[] = [];
  let currentIndex = 0;
  let apiIndex = 0;

  function reuseLiveItem(videoId: string) {
    return currentItemById.get(videoId) ?? apiItemById.get(videoId);
  }

  function drainCurrentUntil(anchorId: string | null) {
    while (currentIndex < currentBand.length && currentBand[currentIndex].videoId !== anchorId) {
      const { videoId, item } = currentBand[currentIndex];
      const isDroppedButRetained = !apiBandIds.has(videoId) && retainedDroppedIds.has(videoId);
      if (isDroppedButRetained) {
        mergedBand.push(item);
      }

      currentIndex++;
    }
  }

  function drainApiUntil(anchorId: string | null) {
    while (apiIndex < apiBand.length && apiBand[apiIndex].videoId !== anchorId) {
      const { videoId, item } = apiBand[apiIndex];
      mergedBand.push(reuseLiveItem(videoId) ?? item);
      apiIndex++;
    }
  }

  for (const anchorId of commonSubsequence) {
    drainCurrentUntil(anchorId);
    drainApiUntil(anchorId);
    const anchorItem = reuseLiveItem(anchorId);
    if (anchorItem) {
      mergedBand.push(anchorItem);
    }

    currentIndex++;
    apiIndex++;
  }
  drainCurrentUntil(null);
  drainApiUntil(null);
  return mergedBand;
}
