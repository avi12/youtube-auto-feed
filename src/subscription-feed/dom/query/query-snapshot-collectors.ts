import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";
import { isPolymerElement } from "../utils/polymer";
import { isRichShelfRenderer, isShelfRenderer, isVideoRenderer } from "../youtube-api/guards";
import { parseRenderer } from "../youtube-api/parse-video";
import { addRichItemToSnapshot } from "./query-snapshot-parse";

export function collectRichShelfVideos(snapshot: Map<string, Prettify<VideoSnapshot>>) {
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    const shelfData = elShelf.data;
    const sectionTitle = isRichShelfRenderer(shelfData) ? shelfData.title?.runs?.[0]?.text ?? "" : "";
    for (const elItem of elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
      addRichItemToSnapshot({
        elItem,
        sectionTitle,
        bandIndex: 0,
        snapshot
      });
    }
  }
}

export function collectLegacyShelfVideos(snapshot: Map<string, Prettify<VideoSnapshot>>) {
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    const shelfData = elShelf.data;
    const sectionTitle = isShelfRenderer(shelfData) ? shelfData.title?.runs?.[0]?.text ?? "" : "";
    for (const elItem of elShelf.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
      if (!isPolymerElement(elItem)) {
        continue;
      }

      const rawRenderer = elItem.data;
      if (!isVideoRenderer(rawRenderer)) {
        continue;
      }

      const videoSnapshot = parseRenderer({
        renderer: rawRenderer,
        sectionTitle,
        bandIndex: 0
      });
      if (!videoSnapshot || snapshot.has(videoSnapshot.videoId)) {
        continue;
      }

      snapshot.set(videoSnapshot.videoId, videoSnapshot);
    }
  }
}
