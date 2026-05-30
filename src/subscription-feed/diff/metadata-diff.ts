import { batchUpdateVideosInDom } from "../dom/update";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";

// Metadata-only diff: a lighter-weight check run on a different polling cadence than the full
// mirror. Only updates title / view count / published time / status / progress bar etc., without
// touching layout. Used to catch metadata changes between the 5s structural polls.

function hasMetadataChange({ previous, fresh }: {
  previous: Prettify<VideoSnapshot>;
  fresh: Prettify<VideoSnapshot>;
}) {
  return previous.title !== fresh.title
    || previous.thumbnailUrl !== fresh.thumbnailUrl
    || previous.status !== fresh.status
    || previous.viewCountText !== fresh.viewCountText
    || previous.publishedTimeText !== fresh.publishedTimeText
    || previous.isChannelLive !== fresh.isChannelLive
    || previous.watchProgressPercent !== fresh.watchProgressPercent;
}

export function detectAndApplyMetadataChanges({
  previousSnapshot,
  freshSnapshots
}: {
  previousSnapshot: Map<string, Prettify<VideoSnapshot>>;
  freshSnapshots: Prettify<VideoSnapshot>[];
}) {
  const updatedSnapshot = new Map(previousSnapshot);
  const changedVideos: Prettify<VideoSnapshot>[] = [];

  for (const fresh of freshSnapshots) {
    const previous = previousSnapshot.get(fresh.videoId);
    if (!previous) {
      continue;
    }

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
