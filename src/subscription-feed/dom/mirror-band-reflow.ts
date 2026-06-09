import type { InnerTubeRichGridItem } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import { absenceCountByVideoId, STICKY_DELETE_POLLS } from "./mirror-constants";

type UpdateAbsenceCountsParams = Prettify<{
  currentBandIds: Set<string>;
  apiBandIds: Set<string>;
  collaborativeIds: Set<string>;
}>;

export function updateAbsenceCountsAndRetain({
  currentBandIds,
  apiBandIds,
  collaborativeIds
}: UpdateAbsenceCountsParams) {
  const retainedDroppedIds = new Set<string>();
  for (const videoId of currentBandIds) {
    if (apiBandIds.has(videoId)) {
      absenceCountByVideoId.delete(videoId);
      continue;
    }

    const absenceCount = (absenceCountByVideoId.get(videoId) ?? 0) + 1;
    absenceCountByVideoId.set(videoId, absenceCount);

    const DROP_IMMEDIATELY = 0;
    const stickyThreshold = collaborativeIds.has(videoId) ? STICKY_DELETE_POLLS : DROP_IMMEDIATELY;
    if (absenceCount <= stickyThreshold) {
      retainedDroppedIds.add(videoId);
    }
  }

  for (const videoId of absenceCountByVideoId.keys()) {
    if (!currentBandIds.has(videoId)) {
      absenceCountByVideoId.delete(videoId);
    }
  }
  return retainedDroppedIds;
}

type ReflowBandParams = Prettify<{
  currentContents: Prettify<InnerTubeRichGridItem>[];
  currentRuns: {
    start: number;
    end: number;
  }[];
  targetBand: Prettify<InnerTubeRichGridItem>[];
}>;

export function reflowBandIntoRuns({ currentContents, currentRuns, targetBand }: ReflowBandParams) {
  const originalIndexByItem = new Map<Prettify<InnerTubeRichGridItem>, number>();
  for (let i = 0; i < currentContents.length; i++) {
    originalIndexByItem.set(currentContents[i], i);
  }

  const result: Prettify<InnerTubeRichGridItem>[] = [];

  function pushBandItem(item: Prettify<InnerTubeRichGridItem>) {
    const originalIndex = originalIndexByItem.get(item);
    const hasMovedIndex = originalIndex !== undefined && originalIndex !== result.length;
    result.push(hasMovedIndex ? structuredClone(item) : item);
  }

  const lastRunIndex = currentRuns.length - 1;
  let bandIndex = 0;
  let readIndex = 0;
  for (let runIndex = 0; runIndex < currentRuns.length; runIndex++) {
    const run = currentRuns[runIndex];
    while (readIndex < run.start) {
      result.push(currentContents[readIndex]);
      readIndex++;
    }

    const isLastRun = runIndex === lastRunIndex;
    const slotCount = isLastRun ? targetBand.length - bandIndex : run.end - run.start;
    for (let slot = 0; slot < slotCount && bandIndex < targetBand.length; slot++, bandIndex++) {
      pushBandItem(targetBand[bandIndex]);
    }
    readIndex = run.end;
  }

  while (readIndex < currentContents.length) {
    result.push(currentContents[readIndex]);
    readIndex++;
  }
  return result;
}
