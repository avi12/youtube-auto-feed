import type { PolymerElement } from "@/subscription-feed/types/polymer";
import type { Prettify } from "@/subscription-feed/types/prettify";
import type { VideoSnapshot } from "@/subscription-feed/types/video";
import { isPolymerElement } from "@/subscription-feed/utils/polymer";
import { isRichShelfRenderer, isShelfRenderer, isVideoRenderer } from "@/subscription-feed/youtube-api/guards";
import { parseRenderer } from "@/subscription-feed/youtube-api/parse-video";
import { RICH_ITEM_SELECTOR } from "@/subscription-feed/dom/mirror/mirror-constants";
import { addRichItemToSnapshot } from "./query-snapshot-parse";

export function collectRichShelfVideos(snapshot: Map<string, Prettify<VideoSnapshot>>) {
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    const shelfData = elShelf.data;
    const sectionTitle = isRichShelfRenderer(shelfData) ? (shelfData.title?.runs?.[0]?.text ?? "") : "";
    for (const elItem of elShelf.querySelectorAll<HTMLElement>(RICH_ITEM_SELECTOR)) {
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
    const sectionTitle = isShelfRenderer(shelfData) ? (shelfData.title?.runs?.[0]?.text ?? "") : "";
    for (const elItem of elShelf.querySelectorAll<PolymerElement>("ytd-grid-video-renderer")) {
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
