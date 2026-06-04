import type { Prettify } from "../../types/prettify";
import type { VideoSnapshot } from "../../types/video";
import { isPolymerElement } from "../../utils/polymer";
import { videoIdFromData } from "../../utils/video-id";
import { isVideoRenderer } from "../../youtube-api/guards";
import { isInViewport } from "../animations";
import { scheduleLazyUpdate } from "../lazy-update";
import { findItemElements } from "../query";
import { applyUpdate } from "./apply-targeted";

// Public surface of the update layer. Internally it dispatches to apply-targeted.ts. Items that
// are in the viewport apply synchronously; off-screen items get deferred to lazy-update.ts.

export { applyUpdate } from "./apply-targeted";

type UpdateVideoInDomParams = Prettify<{
  videoId: string;
  freshSnapshot: Prettify<VideoSnapshot>;
  previousSnapshot?: Prettify<VideoSnapshot>;
}>;

export function updateVideoInDom({ videoId, freshSnapshot, previousSnapshot }: UpdateVideoInDomParams) {
  // Each duplicate of the same video (e.g. Latest band + "Most relevant" shelf) needs its own DOM patch.
  const elItems = findItemElements(videoId).filter(isPolymerElement);
  if (elItems.length === 0) {
    return;
  }

  for (const elItem of elItems) {
    if (isInViewport(elItem)) {
      applyUpdate({
        videoId,
        elItem,
        fresh: freshSnapshot,
        previous: previousSnapshot
      });
    } else {
      scheduleLazyUpdate({
        videoId,
        fresh: freshSnapshot,
        previous: previousSnapshot,
        elItemHint: elItem
      });
    }
  }
}

type AppendToVideoElementMapParams = Prettify<{
  map: Map<string, HTMLElement[]>;
  videoId: string;
  elItem: HTMLElement;
}>;

function appendToVideoElementMap({ map, videoId, elItem }: AppendToVideoElementMapParams) {
  const existing = map.get(videoId);
  if (existing) {
    existing.push(elItem);
    return;
  }

  map.set(videoId, [elItem]);
}

function buildVideoElementMap() {
  const map = new Map<string, HTMLElement[]>();

  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (videoId) {
      appendToVideoElementMap({
        map,
        videoId,
        elItem
      });
    }
  }
  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const { data } = elItem;
    const videoId = isVideoRenderer(data) ? data.videoId : "";
    if (videoId) {
      appendToVideoElementMap({
        map,
        videoId,
        elItem
      });
    }
  }
  return map;
}

// batch variant used by the metadata-only poll: one DOM walk for many videos.
type BatchUpdateVideosInDomParams = Prettify<{
  freshSnapshots: Prettify<VideoSnapshot>[];
  previousSnapshotMap?: Map<string, Prettify<VideoSnapshot>>;
}>;

export function batchUpdateVideosInDom({ freshSnapshots, previousSnapshotMap }: BatchUpdateVideosInDomParams) {
  const elementMap = buildVideoElementMap();
  for (const fresh of freshSnapshots) {
    const elItems = elementMap.get(fresh.videoId) ?? [];
    if (elItems.length === 0) {
      continue;
    }

    const previous = previousSnapshotMap?.get(fresh.videoId);
    for (const elItem of elItems) {
      if (!isPolymerElement(elItem)) {
        continue;
      }

      if (isInViewport(elItem)) {
        applyUpdate({
          videoId: fresh.videoId,
          elItem,
          fresh,
          previous
        });
      } else {
        scheduleLazyUpdate({
          videoId: fresh.videoId,
          fresh,
          previous,
          elItemHint: elItem
        });
      }
    }
  }
}
