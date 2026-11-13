import { applyUpdate, isSwapHeldOffByHover } from "@/subscription-feed/dom/update/apply-targeted";
import type { PolymerElement } from "@/subscription-feed/types/polymer";
import type { Prettify } from "@/subscription-feed/types/prettify";
import type { VideoSnapshot } from "@/subscription-feed/types/video";
import { isPolymerElement } from "@/subscription-feed/utils/polymer";
import { videoIdFromData } from "@/subscription-feed/utils/video-id";

const IDLE_CALLBACK_TIMEOUT_MS = 500;
const LAZY_UPDATE_ROOT_MARGIN_PX = 300;

export const pendingUpdates = new Map<
  string,
  {
    fresh: Prettify<VideoSnapshot>;
    previous?: Prettify<VideoSnapshot>;
    elItems: Set<HTMLElement>;
  }
>();

interface ApplyEntry {
  videoId: string;
  elItem: PolymerElement;
  fresh: VideoSnapshot;
  previous?: VideoSnapshot;
}
const pendingApplyBatch: Prettify<ApplyEntry>[] = [];
let isIdleCallbackScheduled = false;

let intersectionObserver: IntersectionObserver | null = null;

function flushApplyBatch() {
  isIdleCallbackScheduled = false;
  const batch = pendingApplyBatch.splice(0);
  for (const { videoId, elItem, fresh, previous } of batch) {
    // Dropping the entry is safe: the poll kept the previous snapshot for deferred videos, so the
    // change re-detects and re-schedules on the next poll.
    if (
      isSwapHeldOffByHover({
        elItem,
        fresh,
        previous
      })
    ) {
      continue;
    }

    applyUpdate({
      videoId,
      elItem,
      fresh,
      previous
    });
  }
}

export function ensureObserver() {
  if (intersectionObserver) {
    return intersectionObserver;
  }

  intersectionObserver = new IntersectionObserver(
    entries => {
      for (const { isIntersecting, target } of entries) {
        const isObservationEligible = isIntersecting && target instanceof HTMLElement;
        if (!isObservationEligible) {
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
        intersectionObserver?.unobserve(elItem);

        if (!pending) {
          continue;
        }

        const { fresh, previous, elItems } = pending;
        elItems.delete(elItem);

        if (elItems.size === 0) {
          pendingUpdates.delete(videoId);
        }

        pendingApplyBatch.push({
          videoId,
          elItem,
          fresh,
          previous
        });
      }

      const isBatchFlushPending = pendingApplyBatch.length > 0 && !isIdleCallbackScheduled;
      if (isBatchFlushPending) {
        isIdleCallbackScheduled = true;
        requestIdleCallback(flushApplyBatch, { timeout: IDLE_CALLBACK_TIMEOUT_MS });
      }
    },
    { rootMargin: `0px 0px ${LAZY_UPDATE_ROOT_MARGIN_PX}px 0px` }
  );
  return intersectionObserver;
}

export function resetObserverState() {
  pendingUpdates.clear();
  pendingApplyBatch.length = 0;
  isIdleCallbackScheduled = false;
  intersectionObserver?.disconnect();
  intersectionObserver = null;
}
