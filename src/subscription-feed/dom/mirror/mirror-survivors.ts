import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { videoIdFromData } from "../../utils/video-id";
import { GRID_ITEM_SELECTOR } from "./mirror-constants";
import { isInReflowZone } from "./mirror-elements";
import { glideToRest, pinAtOffset } from "./mirror-glide";

type PinSurvivorsParams = Prettify<{
  oldRects: Map<string, DOMRect>;
  newlyInsertedIds: Set<string>;
}>;

export function pinSurvivorsToOldRects({ oldRects, newlyInsertedIds }: PinSurvivorsParams) {
  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isInReflowZone(elItem) || !isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    const isPinnable = !!videoId && !newlyInsertedIds.has(videoId) && oldRects.has(videoId);
    if (!isPinnable) {
      continue;
    }

    const oldRect = oldRects.get(videoId);
    if (!oldRect) {
      continue;
    }

    elItem.style.transition = "none";
    elItem.style.translate = "";
    const newRect = elItem.getBoundingClientRect();
    // Every moved survivor slides from its old slot to its new one (Google-Meet reflow), including
    // tiles that wrap to another row - they glide diagonally rather than snapping or fading.
    pinAtOffset({
      elGlider: elItem,
      deltaX: oldRect.left - newRect.left,
      deltaY: oldRect.top - newRect.top
    });
  }
}

export function releaseSurvivors() {
  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!elItem.style.translate) {
      elItem.style.transition = "";
      continue;
    }

    glideToRest(elItem);
  }
}
