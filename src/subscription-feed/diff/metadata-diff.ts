import { batchUpdateVideosInDom } from "../dom/update";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";

// Metadata-only diff: a lighter-weight check run on a different polling cadence than the full
// mirror. Only updates title / view count / published time / status / progress bar etc., without
// touching layout. Used to catch metadata changes between the 5s structural polls.

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

// YouTube's subscription feed responses are inconsistent about the watch-progress overlay: the same
// already-watched video carries its progress bar in some polls and omits it in others (backend
// eventual consistency). Treating that disappearance as a real change rebuilds the tile, reloading
// its thumbnail and avatar - a visible flicker every time the overlay flickers in and out. So once a
// video has a watch-progress value, a later response that drops it carries the last value forward
// instead of falling back to null. A genuine value change (or first appearance) still flows through.
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
