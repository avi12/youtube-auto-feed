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

// The shared anchors (the LCS of video ids) split both bands into aligned segments. Each merged
// segment keeps the current band's dropped-but-retained items, then the api band's items (reusing
// the live DOM item when present), then the anchor itself.
export function mergeBand({
  currentBand,
  apiBand,
  lcs: anchorIds,
  apiBandIds,
  apiItemById,
  retainedDroppedIds
}: MergeBandParams) {
  const currentItemById = new Map(currentBand.map(({ videoId, item }) => [videoId, item]));

  function reuseLiveItem(videoId: string) {
    return currentItemById.get(videoId) ?? apiItemById.get(videoId);
  }

  function isDroppedButRetained(videoId: string) {
    return !apiBandIds.has(videoId) && retainedDroppedIds.has(videoId);
  }

  const currentSegments = splitAtAnchors(currentBand, anchorIds);
  const apiSegments = splitAtAnchors(apiBand, anchorIds);
  const mergedBand: Prettify<InnerTubeRichGridItem>[] = [];

  for (let iSegment = 0; iSegment <= anchorIds.length; iSegment++) {
    for (const { videoId, item } of currentSegments[iSegment]) {
      if (!isDroppedButRetained(videoId)) {
        continue;
      }

      mergedBand.push(item);
    }

    for (const { videoId, item } of apiSegments[iSegment]) {
      mergedBand.push(reuseLiveItem(videoId) ?? item);
    }

    const anchorId = anchorIds[iSegment];
    const anchorItem = anchorId ? reuseLiveItem(anchorId) : undefined;
    if (anchorItem) {
      mergedBand.push(anchorItem);
    }
  }
  return mergedBand;
}

function splitAtAnchors(band: InlineBandEntry[], anchorIds: string[]) {
  const segments: InlineBandEntry[][] = [[]];
  let iAnchor = 0;
  for (const entry of band) {
    if (iAnchor < anchorIds.length && entry.videoId === anchorIds[iAnchor]) {
      iAnchor++;
      segments.push([]);
    } else {
      segments[segments.length - 1].push(entry);
    }
  }
  return segments;
}
