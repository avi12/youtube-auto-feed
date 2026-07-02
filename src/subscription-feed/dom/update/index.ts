import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import type { VideoSnapshot } from "../../types/video";
import { isPolymerElement } from "../../utils/polymer";
import { isInViewport } from "../animations";
import { scheduleLazyUpdate } from "../lazy/lazy-update";
import { applyUpdate } from "./apply-targeted";
import { buildVideoElementMap } from "./video-element-map";

type ApplyOrScheduleParams = Prettify<{
  videoId: string;
  elItem: PolymerElement;
  fresh: Prettify<VideoSnapshot>;
  previous?: Prettify<VideoSnapshot>;
}>;

function applyOrScheduleUpdate({ videoId, elItem, fresh, previous }: ApplyOrScheduleParams) {
  if (isInViewport(elItem)) {
    applyUpdate({
      videoId,
      elItem,
      fresh,
      previous
    });
    return true;
  }

  scheduleLazyUpdate({
    videoId,
    fresh,
    previous,
    elItemHint: elItem
  });
  return false;
}

type BatchUpdateVideosInDomParams = Prettify<{
  freshSnapshots: Prettify<VideoSnapshot>[];
  previousSnapshotMap?: Map<string, Prettify<VideoSnapshot>>;
}>;

// Metadata-only poll: one DOM walk shared across many videos. Returns the ids whose update landed
// in the DOM now; deferred (lazy) and element-less updates are excluded so the caller can keep the
// previous snapshot and re-detect them on the next poll.
export function batchUpdateVideosInDom({ freshSnapshots, previousSnapshotMap }: BatchUpdateVideosInDomParams) {
  const appliedVideoIds = new Set<string>();
  const elementMap = buildVideoElementMap();
  for (const fresh of freshSnapshots) {
    const elItems = elementMap.get(fresh.videoId) ?? [];
    const previous = previousSnapshotMap?.get(fresh.videoId);
    for (const elItem of elItems) {
      if (!isPolymerElement(elItem)) {
        continue;
      }

      const isAppliedNow = applyOrScheduleUpdate({
        videoId: fresh.videoId,
        elItem,
        fresh,
        previous
      });
      if (isAppliedNow) {
        appliedVideoIds.add(fresh.videoId);
      }
    }
  }
  return appliedVideoIds;
}
