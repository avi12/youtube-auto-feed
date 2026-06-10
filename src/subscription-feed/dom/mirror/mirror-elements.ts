import { isPolymerElement } from "../utils/polymer";
import { videoIdFromData } from "../utils/video-id";
import { GRID_ITEM_SELECTOR, REFLOW_MARGIN_BELOW_PX } from "./mirror-constants";

export function thumbnailContainerInItem(elItem: HTMLElement) {
  const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
  const root: HTMLElement | ShadowRoot = elLockup?.shadowRoot ?? elLockup ?? elItem;
  return root.querySelector<HTMLElement>("yt-thumbnail-view-model, ytd-thumbnail");
}

export function avatarImgInItem(elItem: HTMLElement) {
  const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
  const root: HTMLElement | ShadowRoot = elLockup?.shadowRoot ?? elLockup ?? elItem;
  return root.querySelector<HTMLImageElement>("yt-decorated-avatar-view-model img");
}

// Scoped to the thumbnail containers so the channel avatar is never repainted with a video URL.
export function thumbnailImgsInItem(elItem: HTMLElement) {
  const elImgs: HTMLImageElement[] = [];
  const searchRoots: (HTMLElement | ShadowRoot)[] = [elItem];
  const elLockup = elItem.querySelector("yt-lockup-view-model");
  if (elLockup?.shadowRoot) {
    searchRoots.push(elLockup.shadowRoot);
  }

  for (const searchRoot of searchRoots) {
    for (const elContainer of searchRoot.querySelectorAll<HTMLElement>("yt-thumbnail-view-model, ytd-thumbnail")) {
      const containerRoot: HTMLElement | ShadowRoot = elContainer.shadowRoot ?? elContainer;
      for (const elImg of containerRoot.querySelectorAll<HTMLImageElement>("img")) {
        elImgs.push(elImg);
      }
      for (const elYtImage of containerRoot.querySelectorAll<HTMLElement>("yt-image")) {
        const elImg = elYtImage.shadowRoot?.querySelector<HTMLImageElement>("img");
        if (elImg) {
          elImgs.push(elImg);
        }
      }
    }
  }
  return elImgs;
}

export function isInReflowZone(elItem: HTMLElement) {
  const { bottom, top } = elItem.getBoundingClientRect();
  return bottom > 0 && top < innerHeight + REFLOW_MARGIN_BELOW_PX;
}

export function recordReflowZoneRects() {
  const rects = new Map<string, DOMRect>();
  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isInReflowZone(elItem) || !isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (videoId) {
      rects.set(videoId, elItem.getBoundingClientRect());
    }
  }
  return rects;
}
