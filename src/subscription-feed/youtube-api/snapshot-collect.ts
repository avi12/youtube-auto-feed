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
  const isFreshSnapshot = !!snapshot && !seenVideoIds.has(snapshot.videoId);
  if (!isFreshSnapshot) {
    return;
  }

  seenVideoIds.add(snapshot.videoId);
  snapshots.push(snapshot);
}
