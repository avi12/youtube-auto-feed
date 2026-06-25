import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";
import { isChannelVideoPlayerRenderer, isLockupViewModel, isShortsLockupViewModel, isVideoRenderer } from "./guards";
import {
  parseChannelVideoPlayer,
  parseLockupViewModel,
  parseRenderer,
  parseShortsLockupViewModel
} from "./parse-video";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Walk an arbitrary ytInitialData tree and collect every video-bearing renderer into one snapshot
// list, keyed off the wrapper key so unrelated videoId fields (menus, endpoints) are ignored. This
// powers the page-agnostic metadata updater - channel grids, channel home shelves and trailer,
// watch-page related, search, home feed - so each page type needs no bespoke structural parsing.
export function collectAllVideoSnapshots(data: unknown) {
  const snapshots: Prettify<VideoSnapshot>[] = [];
  const seenVideoIds = new Set<string>();

  function add(snapshot: VideoSnapshot | null) {
    if (!snapshot || seenVideoIds.has(snapshot.videoId)) {
      return;
    }

    seenVideoIds.add(snapshot.videoId);
    snapshots.push(snapshot);
  }

  const stack: unknown[] = [data];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }

    if (!isObjectRecord(node)) {
      continue;
    }

    const {
      videoRenderer,
      gridVideoRenderer,
      lockupViewModel,
      shortsLockupViewModel,
      channelVideoPlayerRenderer
    } = node;
    if (isVideoRenderer(videoRenderer)) {
      add(
        parseRenderer({
          renderer: videoRenderer,
          sectionTitle: "",
          bandIndex: 0
        })
      );
    }

    if (isVideoRenderer(gridVideoRenderer)) {
      add(
        parseRenderer({
          renderer: gridVideoRenderer,
          sectionTitle: "",
          bandIndex: 0
        })
      );
    }

    if (isLockupViewModel(lockupViewModel)) {
      add(
        parseLockupViewModel({
          lockup: lockupViewModel,
          sectionTitle: "",
          bandIndex: 0
        })
      );
    }

    if (isShortsLockupViewModel(shortsLockupViewModel)) {
      add(
        parseShortsLockupViewModel({
          shortsLockup: shortsLockupViewModel,
          sectionTitle: "",
          bandIndex: 0
        })
      );
    }

    if (isChannelVideoPlayerRenderer(channelVideoPlayerRenderer)) {
      add(parseChannelVideoPlayer(channelVideoPlayerRenderer));
    }

    for (const key in node) {
      stack.push(node[key]);
    }
  }

  return snapshots;
}
