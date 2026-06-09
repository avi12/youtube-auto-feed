import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { videoIdFromData } from "../../utils/video-id";
import { isVideoRenderer } from "../../youtube-api/guards";

// Builds a videoId -> elements map in one DOM walk, used by the batched metadata-only poll so many
// videos share a single traversal.

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

export function buildVideoElementMap() {
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
