import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";
import { absenceCountByVideoId, STICKY_DELETE_POLLS } from "./mirror-constants";

type UpdateAbsenceCountsParams = Prettify<{
  currentBandIds: Set<string>;
  apiBandIds: Set<string>;
  collaborativeIds: Set<string>;
  tailIds: Set<string>;
}>;

export function updateAbsenceCountsAndRetain({
  currentBandIds,
  apiBandIds,
  collaborativeIds,
  tailIds
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
    const isPaginationNoise = collaborativeIds.has(videoId) || tailIds.has(videoId);
    const stickyThreshold = isPaginationNoise ? STICKY_DELETE_POLLS : DROP_IMMEDIATELY;
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
  for (const [i, item] of currentContents.entries()) {
    originalIndexByItem.set(item, i);
  }

  const result: Prettify<InnerTubeRichGridItem>[] = [];

  function pushBandItem(item: Prettify<InnerTubeRichGridItem>) {
    const iOriginal = originalIndexByItem.get(item);
    const isIndexMoved = iOriginal !== undefined && iOriginal !== result.length;
    result.push(isIndexMoved ? structuredClone(item) : item);
  }

  const iLastRun = currentRuns.length - 1;
  let iBand = 0;
  let iRead = 0;
  for (const [iRun, run] of currentRuns.entries()) {
    result.push(...currentContents.slice(iRead, run.start));

    const isLastRun = iRun === iLastRun;
    const slotCount = isLastRun ? targetBand.length - iBand : run.end - run.start;
    for (const item of targetBand.slice(iBand, iBand + slotCount)) {
      pushBandItem(item);
    }
    iBand = Math.min(iBand + slotCount, targetBand.length);
    iRead = run.end;
  }

  result.push(...currentContents.slice(iRead));
  return result;
}
