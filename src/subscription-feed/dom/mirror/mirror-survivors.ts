import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { videoIdFromData } from "../../utils/video-id";
import { GRID_ITEM_SELECTOR, SURVIVOR_SHIFT_MS } from "./mirror-constants";
import { isInReflowZone } from "./mirror-elements";

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
    const deltaX = oldRect.left - newRect.left;
    const deltaY = oldRect.top - newRect.top;

    // Every moved survivor slides from its old slot to its new one (Google-Meet reflow), including
    // tiles that wrap to another row - they glide diagonally rather than snapping or fading.
    const hasMoved = Math.abs(deltaX) >= 1 || Math.abs(deltaY) >= 1;
    if (hasMoved) {
      elItem.style.translate = `${deltaX}px ${deltaY}px`;
    }
  }
}

export function releaseSurvivors() {
  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!elItem.style.translate) {
      elItem.style.transition = "";
      continue;
    }

    elItem.style.transition = `translate ${SURVIVOR_SHIFT_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    elItem.style.translate = "";
    elItem.addEventListener("transitionend", () => {
      elItem.style.transition = "";
      elItem.style.translate = "";
    }, { once: true });
  }
}
