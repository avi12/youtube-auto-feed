import { isInViewport } from "@/subscription-feed/dom/animations";
import { videoIdFromRichItem } from "@/subscription-feed/dom/rich-item";
import type { InnerTubeRichGridItem } from "@/subscription-feed/types/innertube";
import type { Prettify } from "@/subscription-feed/types/prettify";
import { isPolymerElement } from "@/subscription-feed/utils/polymer";
import { videoIdFromData } from "@/subscription-feed/utils/video-id";

import { GRID_ITEM_SELECTOR } from "./mirror-constants";

export function findNewlyInsertedElements(newVideoIds: Set<string>) {
  const result: HTMLElement[] = [];
  const seen = new Set<string>();
  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    const isFirstMatch = !!videoId && newVideoIds.has(videoId) && !seen.has(videoId);
    if (!isFirstMatch) {
      continue;
    }

    seen.add(videoId);
    result.push(elItem);
  }
  return result;
}

export function findRemovedViewportTiles(newContents: Prettify<InnerTubeRichGridItem>[]) {
  const newInlineIds = new Set(newContents.map(videoIdFromRichItem).filter(Boolean));
  return [...document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)].filter(isInViewport).filter(elItem => {
    const videoId = isPolymerElement(elItem) ? videoIdFromData(elItem.data) : "";
    return !!videoId && !newInlineIds.has(videoId);
  });
}
