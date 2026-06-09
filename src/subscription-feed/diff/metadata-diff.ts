import { batchUpdateVideosInDom } from "../dom/update";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";

type HasMetadataChangeParams = Prettify<{
  previous: Prettify<VideoSnapshot>;
  fresh: Prettify<VideoSnapshot>;
}>;

function hasMetadataChange({ previous, fresh }: HasMetadataChangeParams) {
  return previous.title !== fresh.title
    || previous.thumbnailUrl !== fresh.thumbnailUrl
    || previous.status !== fresh.status
    || previous.viewCountText !== fresh.viewCountText
    || previous.publishedTimeText !== fresh.publishedTimeText
    || previous.isChannelLive !== fresh.isChannelLive
    || previous.watchProgressPercent !== fresh.watchProgressPercent;
}

type StickyWatchProgressParams = Prettify<{
  fresh: Prettify<VideoSnapshot>;
  previous: Prettify<VideoSnapshot> | undefined;
}>;

// YouTube inconsistently drops the watch-progress overlay; carry the last value
// forward so the tile isn't rebuilt and flickered.
export function withStickyWatchProgress({ fresh, previous }: StickyWatchProgressParams) {
  const shouldCarryForward = fresh.watchProgressPercent === null
    && previous !== undefined
    && previous.watchProgressPercent !== null;
  if (!shouldCarryForward) {
    return fresh;
  }

  return {
    ...fresh,
    watchProgressPercent: previous.watchProgressPercent
  };
}

type DetectAndApplyMetadataChangesParams = Prettify<{
  previousSnapshot: Map<string, Prettify<VideoSnapshot>>;
  freshSnapshots: Prettify<VideoSnapshot>[];
}>;

export function detectAndApplyMetadataChanges({
  previousSnapshot,
  freshSnapshots
}: DetectAndApplyMetadataChangesParams) {
  const updatedSnapshot = new Map(previousSnapshot);
  const changedVideos: Prettify<VideoSnapshot>[] = [];

  for (const rawFresh of freshSnapshots) {
    const previous = previousSnapshot.get(rawFresh.videoId);
    if (!previous) {
      continue;
    }

    const fresh = withStickyWatchProgress({
      fresh: rawFresh,
      previous
    });
    if (hasMetadataChange({
      previous,
      fresh
    })) {
      changedVideos.push(fresh);
      updatedSnapshot.set(fresh.videoId, {
        ...fresh,
        sectionTitle: previous.sectionTitle,
        bandIndex: previous.bandIndex
      });
    }
  }

  if (changedVideos.length > 0) {
    batchUpdateVideosInDom({
      freshSnapshots: changedVideos,
      previousSnapshotMap: previousSnapshot
    });
  }

  return updatedSnapshot;
}
