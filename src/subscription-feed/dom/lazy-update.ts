import type { PolymerElement } from "../types/polymer";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";
import { isPolymerElement } from "../utils/polymer";
import { videoIdFromData } from "../utils/video-id";
import { findItemElements } from "./query";
import { applyUpdate } from "./update";

// Lazy update: instead of mutating off-screen DOM right away, schedule the work and run it when
// the element scrolls into view. This avoids re-rendering thousands of off-screen lockups during
// a single poll, and prevents layout thrash on long feeds.

const IDLE_CALLBACK_TIMEOUT_MS = 500;
const LAZY_UPDATE_ROOT_MARGIN_PX = 300;

const pendingUpdates = new Map<string, {
  fresh: Prettify<VideoSnapshot>;
  previous?: Prettify<VideoSnapshot>;
}>();

type ApplyEntry = {
  videoId: string;
  elItem: PolymerElement;
  fresh: VideoSnapshot;
  previous?: VideoSnapshot;
};
const pendingApplyBatch: Prettify<ApplyEntry>[] = [];
let isIdleCallbackScheduled = false;

let intersectionObserver: IntersectionObserver | null = null;

function flushApplyBatch() {
  isIdleCallbackScheduled = false;
  const batch = pendingApplyBatch.splice(0);
  for (const { videoId, elItem, fresh, previous } of batch) {
    applyUpdate({
      videoId,
      elItem,
      fresh,
      previous
    });
  }
}

function ensureObserver() {
  if (intersectionObserver) {
    return intersectionObserver;
  }

  intersectionObserver = new IntersectionObserver(entries => {
    for (const { isIntersecting, target } of entries) {
      const shouldSkipObservation = !isIntersecting || !(target instanceof HTMLElement);
      if (shouldSkipObservation) {
        continue;
      }

      const elItem = target;
      if (!isPolymerElement(elItem)) {
        continue;
      }

      const videoId = videoIdFromData(elItem.data);
      if (!videoId) {
        continue;
      }

      const pending = pendingUpdates.get(videoId);
      // A duplicate (Latest + shelf) may have already consumed the pending update via its own
      // observer; drop the now-stale observer for this element so we don't keep watching it.
      if (!pending) {
        intersectionObserver?.unobserve(elItem);
        continue;
      }

      const { fresh, previous } = pending;
      pendingUpdates.delete(videoId);
      intersectionObserver?.unobserve(elItem);
      pendingApplyBatch.push({
        videoId,
        elItem,
        fresh,
        previous
      });
    }

    const hasBatchToFlush = pendingApplyBatch.length > 0 && !isIdleCallbackScheduled;
    if (hasBatchToFlush) {
      isIdleCallbackScheduled = true;
      requestIdleCallback(flushApplyBatch, { timeout: IDLE_CALLBACK_TIMEOUT_MS });
    }
  }, { rootMargin: `0px 0px ${LAZY_UPDATE_ROOT_MARGIN_PX}px 0px` });
  return intersectionObserver;
}

type ScheduleLazyUpdateParams = Prettify<{
  videoId: string;
  fresh: Prettify<VideoSnapshot>;
  previous?: Prettify<VideoSnapshot>;
  elItemHint?: HTMLElement;
}>;

export function scheduleLazyUpdate({ videoId, fresh, previous, elItemHint }: ScheduleLazyUpdateParams) {
  const existing = pendingUpdates.get(videoId);
  pendingUpdates.set(videoId, {
    fresh,
    previous: existing?.previous ?? previous
  });
  // Observe every duplicate of this video; whichever scrolls into view first consumes it.
  const elItems = elItemHint ? [elItemHint] : findItemElements(videoId);
  const observer = ensureObserver();
  for (const elItem of elItems) {
    observer.observe(elItem);
  }
}

export function resetLazyUpdates() {
  pendingUpdates.clear();
  pendingApplyBatch.length = 0;
  isIdleCallbackScheduled = false;
  intersectionObserver?.disconnect();
  intersectionObserver = null;
}
