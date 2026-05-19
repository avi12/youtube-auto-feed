import { isPolymerElement, videoIdFromData } from "../helpers";
import type { PolymerElement, VideoSnapshot } from "../types";
import { prefersReducedMotion, triggerAnimation } from "./animations";
import { findItemElement } from "./query";
import { applyUpdate } from "./update";

const IDLE_CALLBACK_TIMEOUT_MS = 500;
const LAZY_UPDATE_ROOT_MARGIN_PX = 300;
const LAZY_ENTRANCE_ROOT_MARGIN_PX = 50;

const pendingUpdates = new Map<string, {
  fresh: VideoSnapshot;
  previous?: VideoSnapshot;
}>();

type ApplyEntry = { videoId: string; elItem: PolymerElement; fresh: VideoSnapshot; previous?: VideoSnapshot };
const pendingApplyBatch: ApplyEntry[] = [];
let isIdleCallbackScheduled = false;

let intersectionObserver: IntersectionObserver | null = null;

function flushApplyBatch() {
  isIdleCallbackScheduled = false;
  const batch = pendingApplyBatch.splice(0);
  for (const { videoId, elItem, fresh, previous } of batch) {
    applyUpdate(videoId, elItem, fresh, previous);
  }
}

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
      pendingApplyBatch.push({ videoId, elItem, fresh: pending.fresh, previous: pending.previous });
    }

    if (pendingApplyBatch.length > 0 && !isIdleCallbackScheduled) {
      isIdleCallbackScheduled = true;
      requestIdleCallback(flushApplyBatch, { timeout: IDLE_CALLBACK_TIMEOUT_MS });
    }
  }, { rootMargin: `0px 0px ${LAZY_UPDATE_ROOT_MARGIN_PX}px 0px` });
  return intersectionObserver;
}

export function scheduleLazyUpdate({ videoId, fresh, previous, elItemHint }: { videoId: string; fresh: VideoSnapshot; previous?: VideoSnapshot; elItemHint?: HTMLElement }) {
  pendingUpdates.set(videoId, {
    fresh,
    previous
  });
  const elItem = elItemHint ?? findItemElement(videoId);
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
      triggerAnimation({ elTarget: elItem, animationClass: "ytsua-new" });
    }

    if (pendingEntranceItems.size === 0) {
      entranceObserver?.disconnect();
      entranceObserver = null;
    }
  }, { rootMargin: `${LAZY_ENTRANCE_ROOT_MARGIN_PX}px 0px 0px 0px` });
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
  pendingApplyBatch.length = 0;
  isIdleCallbackScheduled = false;
  pendingEntranceItems.clear();
  intersectionObserver?.disconnect();
  intersectionObserver = null;
  entranceObserver?.disconnect();
  entranceObserver = null;
}
