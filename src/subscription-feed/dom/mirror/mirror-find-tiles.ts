import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { videoIdFromData } from "../../utils/video-id";
import { isInViewport } from "../animations";
import { videoIdFromRichItem } from "../rich-item";
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
    if (isFirstMatch) {
      seen.add(videoId);
      result.push(elItem);
    }
  }
  return result;
}

export function findRemovedViewportTiles(newContents: Prettify<InnerTubeRichGridItem>[]) {
  const newInlineIds = new Set(newContents.map(videoIdFromRichItem).filter(Boolean));
  return [...document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)]
    .filter(isInViewport)
    .filter(elItem => {
      const videoId = isPolymerElement(elItem) ? videoIdFromData(elItem.data) : "";
      return !!videoId && !newInlineIds.has(videoId);
    });
}
