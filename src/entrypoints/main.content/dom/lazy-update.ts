import { isPolymerElement, videoIdFromData } from "../helpers";
import type { VideoSnapshot } from "../types";
import { prefersReducedMotion, triggerAnimation } from "./animations";
import { findItemElement } from "./query";
import { applyUpdate } from "./update";

const pendingUpdates = new Map<string, {
  fresh: VideoSnapshot;
  previous?: VideoSnapshot;
}>();
let intersectionObserver: IntersectionObserver | null = null;

function ensureObserver() {
  if (intersectionObserver) {
    return intersectionObserver;
  }

  intersectionObserver = new IntersectionObserver(entries => {
    for (const { isIntersecting, target } of entries) {
      if (!isIntersecting) {
        continue;
      }

      const elItem = target as HTMLElement;
      if (!isPolymerElement(elItem)) {
        continue;
      }

      const videoId = videoIdFromData(elItem.data);
      if (!videoId) {
        continue;
      }

      const pending = pendingUpdates.get(videoId);
      if (!pending) {
        continue;
      }

      pendingUpdates.delete(videoId);
      intersectionObserver?.unobserve(elItem);
      applyUpdate(videoId, elItem, pending.fresh, pending.previous);
    }
  }, { rootMargin: "0px 0px 300px 0px" });
  return intersectionObserver;
}

export function scheduleLazyUpdate(videoId: string, fresh: VideoSnapshot, previous?: VideoSnapshot) {
  pendingUpdates.set(videoId, {
    fresh,
    previous
  });
  const elItem = findItemElement(videoId);
  if (elItem) {
    ensureObserver().observe(elItem);
  }
}

const pendingEntranceItems = new Set<HTMLElement>();
let entranceObserver: IntersectionObserver | null = null;

function ensureEntranceObserver() {
  if (entranceObserver) {
    return entranceObserver;
  }

  entranceObserver = new IntersectionObserver(entries => {
    for (const { isIntersecting, target } of entries) {
      if (!isIntersecting) {
        continue;
      }

      const elItem = target as HTMLElement;
      if (!pendingEntranceItems.delete(elItem)) {
        continue;
      }

      entranceObserver?.unobserve(elItem);
      triggerAnimation(elItem, "ytsua-new");
    }

    if (pendingEntranceItems.size === 0) {
      entranceObserver?.disconnect();
      entranceObserver = null;
    }
  }, { rootMargin: "50px 0px 0px 0px" });
  return entranceObserver;
}

export function scheduleLazyEntrance(elItems: HTMLElement[]) {
  if (elItems.length === 0 || prefersReducedMotion()) {
    return;
  }

  const observer = ensureEntranceObserver();
  for (const elItem of elItems) {
    pendingEntranceItems.add(elItem);
    observer.observe(elItem);
  }
}

export function resetLazyUpdates() {
  pendingUpdates.clear();
  pendingEntranceItems.clear();
  intersectionObserver?.disconnect();
  intersectionObserver = null;
  entranceObserver?.disconnect();
  entranceObserver = null;
}
