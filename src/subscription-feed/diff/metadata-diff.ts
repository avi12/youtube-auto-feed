import { batchUpdateVideosInDom } from "../dom/update";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";

// Metadata-only diff - lighter than a full mirror. Updates title/view-count/status/progress in
// place without touching layout. Catches metadata changes between 5s structural polls.

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

// YouTube inconsistently includes the watch-progress overlay (backend eventual consistency).
// Treating a missing overlay as a real change rebuilds the tile and causes visible flicker.
// Once set, carry the last progress value forward if the API drops it; genuine changes still flow through.
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
