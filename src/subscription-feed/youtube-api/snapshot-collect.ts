import type { InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";
import { parseLockupViewModel, parseRenderer, parseShortsLockupViewModel } from "./parse-video";

export interface AnyRendererParams {
  sectionTitle: string;
  bandIndex: number;
  renderer?: InnerTubeVideoRenderer;
  lockup?: LockupViewModel;
  shortsLockup?: ShortsLockupViewModel;
}

interface CollectSnapshotParams extends AnyRendererParams {
  snapshots: VideoSnapshot[];
  seenVideoIds: Set<string>;
}

function furthestWatchProgress(
  first: VideoSnapshot["watchProgressPercent"],
  second: VideoSnapshot["watchProgressPercent"]
) {
  if (first === null || second === null) {
    return first ?? second;
  }

  return Math.max(first, second);
}

// A video listed in two bands (Latest and a shelf) can report different progress per copy, and
// YouTube serves the stale one first as often as not. The kept snapshot speaks for every tile of
// the video, so it takes the furthest progress any copy reports.
function mergeDuplicateWatchProgress({
  snapshots,
  duplicate
}: {
  snapshots: VideoSnapshot[];
  duplicate: VideoSnapshot;
}) {
  const iKept = snapshots.findIndex(({ videoId }) => videoId === duplicate.videoId);
  const kept = snapshots[iKept];
  if (!kept) {
    return;
  }

  snapshots[iKept] = {
    ...kept,
    watchProgressPercent: furthestWatchProgress(kept.watchProgressPercent, duplicate.watchProgressPercent)
  };
}

function parseAnyRenderer({ sectionTitle, bandIndex, renderer, lockup, shortsLockup }: Prettify<AnyRendererParams>) {
  if (renderer) {
    return parseRenderer({
      renderer,
      sectionTitle,
      bandIndex
    });
  }

  if (lockup) {
    return parseLockupViewModel({
      lockup,
      sectionTitle,
      bandIndex
    });
  }

  if (shortsLockup) {
    return parseShortsLockupViewModel({
      shortsLockup,
      sectionTitle,
      bandIndex
    });
  }

  return null;
}

export function collectSnapshot({
  sectionTitle,
  bandIndex,
  snapshots,
  seenVideoIds,
  renderer,
  lockup,
  shortsLockup
}: Prettify<CollectSnapshotParams>) {
  const snapshot = parseAnyRenderer({
    sectionTitle,
    bandIndex,
    renderer,
    lockup,
    shortsLockup
  });
  if (!snapshot) {
    return;
  }

  if (seenVideoIds.has(snapshot.videoId)) {
    mergeDuplicateWatchProgress({
      snapshots,
      duplicate: snapshot
    });
    return;
  }

  seenVideoIds.add(snapshot.videoId);
  snapshots.push(snapshot);
}
