import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";
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
    const iOriginal = originalIndexByItem.get(item);
    const isIndexMoved = iOriginal !== undefined && iOriginal !== result.length;
    result.push(isIndexMoved ? structuredClone(item) : item);
  }

  const iLastRun = currentRuns.length - 1;
  let iBand = 0;
  let iRead = 0;
  for (let iRun = 0; iRun < currentRuns.length; iRun++) {
    const run = currentRuns[iRun];
    while (iRead < run.start) {
      result.push(currentContents[iRead]);
      iRead++;
    }

    const isLastRun = iRun === iLastRun;
    const slotCount = isLastRun ? targetBand.length - iBand : run.end - run.start;
    for (let iSlot = 0; iSlot < slotCount && iBand < targetBand.length; iSlot++, iBand++) {
      pushBandItem(targetBand[iBand]);
    }
    iRead = run.end;
  }

  while (iRead < currentContents.length) {
    result.push(currentContents[iRead]);
    iRead++;
  }
  return result;
}
