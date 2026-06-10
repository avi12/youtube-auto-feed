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
    return;
  }

  scheduleLazyUpdate({
    videoId,
    fresh,
    previous,
    elItemHint: elItem
  });
}

type BatchUpdateVideosInDomParams = Prettify<{
  freshSnapshots: Prettify<VideoSnapshot>[];
  previousSnapshotMap?: Map<string, Prettify<VideoSnapshot>>;
}>;

// Metadata-only poll: one DOM walk shared across many videos.
export function batchUpdateVideosInDom({ freshSnapshots, previousSnapshotMap }: BatchUpdateVideosInDomParams) {
  const elementMap = buildVideoElementMap();
  for (const fresh of freshSnapshots) {
    const elItems = elementMap.get(fresh.videoId) ?? [];
    const previous = previousSnapshotMap?.get(fresh.videoId);
    for (const elItem of elItems) {
      if (!isPolymerElement(elItem)) {
        continue;
      }

      applyOrScheduleUpdate({
        videoId: fresh.videoId,
        elItem,
        fresh,
        previous
      });
    }
  }
}
