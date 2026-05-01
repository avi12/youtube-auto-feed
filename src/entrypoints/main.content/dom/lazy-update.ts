import { isPolymerElement, videoIdFromData } from "../helpers";
import type { VideoSnapshot } from "../types";
import { findItemElement } from "./query";
import { applyUpdate } from "./update";

const pendingUpdates = new Map<string, { fresh: VideoSnapshot; previous?: VideoSnapshot }>();
let intersectionObserver: IntersectionObserver | null = null;

function ensureObserver() {
  if (intersectionObserver) return intersectionObserver;
  intersectionObserver = new IntersectionObserver((entries) => {
    for (const { isIntersecting, target } of entries) {
      if (!isIntersecting) continue;
      const elItem = target as HTMLElement;
      if (!isPolymerElement(elItem)) continue;
      const videoId = videoIdFromData(elItem.data);
      if (!videoId) continue;
      const pending = pendingUpdates.get(videoId);
      if (!pending) continue;
      pendingUpdates.delete(videoId);
      intersectionObserver?.unobserve(elItem);
      applyUpdate(videoId, elItem, pending.fresh, pending.previous);
    }
  }, { rootMargin: "0px 0px 300px 0px" });
  return intersectionObserver;
}

export function isElementInViewport(element: Element) {
  const { top, bottom } = element.getBoundingClientRect();
  return bottom > 0 && top < innerHeight;
}

export function scheduleLazyUpdate(videoId: string, fresh: VideoSnapshot, previous?: VideoSnapshot) {
  pendingUpdates.set(videoId, { fresh, previous });
  const elItem = findItemElement(videoId);
  if (elItem) {
    ensureObserver().observe(elItem);
  }
}

export function resetLazyUpdates() {
  pendingUpdates.clear();
  intersectionObserver?.disconnect();
  intersectionObserver = null;
}
