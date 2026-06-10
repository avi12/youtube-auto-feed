import { isPolymerElement } from "../../utils/polymer";
import { videoIdFromData } from "../../utils/video-id";
import { isInViewport } from "../animations";
import { GRID_ITEM_SELECTOR } from "./mirror-constants";
import { findNewlyInsertedElements } from "./mirror-find-tiles";

export function animateNewEntrances(newlyInsertedIds: Set<string>) {
  if (newlyInsertedIds.size === 0) {
    return;
  }

  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (!videoId || !newlyInsertedIds.has(videoId)) {
      continue;
    }

    elItem.style.opacity = "";

    if (isInViewport(elItem)) {
      // Raise new tiles above the pinned survivors they overlap at the start of the glide.
      elItem.style.zIndex = "1";
      elItem.classList.add("ytaf-new");
      elItem.addEventListener("animationend", () => {
        elItem.classList.remove("ytaf-new");
        elItem.style.zIndex = "";
      }, { once: true });
    }
  }
}

export function hideNewInsertedTiles(newlyInsertedIds: Set<string>) {
  if (newlyInsertedIds.size === 0) {
    return;
  }

  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isInViewport(elItem) || !isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (videoId && newlyInsertedIds.has(videoId)) {
      elItem.style.opacity = "0";
    }
  }
}

export function areInsertedTilesPresent(newlyInsertedIds: Set<string>) {
  return findNewlyInsertedElements(newlyInsertedIds).length === newlyInsertedIds.size;
}
