import type { InnerTubeRichGridItem } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import { mergeBand } from "./mirror-band-merge";
import { reflowBandIntoRuns, updateAbsenceCountsAndRetain } from "./mirror-band-reflow";
import { collectInlineVideoIds, extractInlineBand, findAllInlineRuns, isReferenceEqualArray } from "./mirror-band-runs";
import { longestCommonSubsequence } from "./mirror-lcs";
import { isCollaborativeRichItem, videoIdFromRichItem } from "./rich-item";

export { collectInlineVideoIds, isReferenceEqualArray };

type ComposeNewContentsParams = Prettify<{
  apiContents: Prettify<InnerTubeRichGridItem>[];
  currentContents: Prettify<InnerTubeRichGridItem>[];
}>;

export function composeNewContents({ apiContents, currentContents }: ComposeNewContentsParams) {
  const currentRuns = findAllInlineRuns(currentContents);
  if (currentRuns.length === 0) {
    return currentContents;
  }

  const currentBand = extractInlineBand(currentContents);
  const currentBandIds = new Set(currentBand.map(entry => entry.videoId));

  const apiBand = extractInlineBand(apiContents);
  const apiBandIds = new Set(apiBand.map(entry => entry.videoId));
  const apiItemById = new Map(apiBand.map(entry => [entry.videoId, entry.item]));

  const collaborativeIds = new Set(
    currentBand.filter(entry => isCollaborativeRichItem(entry.item)).map(entry => entry.videoId)
  );
  const retainedDroppedIds = updateAbsenceCountsAndRetain({
    currentBandIds,
    apiBandIds,
    collaborativeIds
  });

  const commonSubsequence = longestCommonSubsequence(
    currentBand.map(entry => entry.videoId),
    apiBand.map(entry => entry.videoId)
  );
  const targetBand = mergeBand({
    currentBand,
    apiBand,
    lcs: commonSubsequence,
    apiBandIds,
    apiItemById,
    retainedDroppedIds
  });

  const isUnchanged = targetBand.length === currentBand.length
    && targetBand.every((item, i) => videoIdFromRichItem(item) === currentBand[i].videoId);
  if (isUnchanged) {
    return currentContents;
  }

  return reflowBandIntoRuns({
    currentContents,
    currentRuns,
    targetBand
  });
}
