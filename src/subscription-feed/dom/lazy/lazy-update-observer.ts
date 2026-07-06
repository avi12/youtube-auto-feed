import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import type { VideoSnapshot } from "../../types/video";
import { isPolymerElement } from "../../utils/polymer";
import { videoIdFromData } from "../../utils/video-id";
import { applyUpdate, isSwapHeldOffByHover } from "../update/apply-targeted";

const IDLE_CALLBACK_TIMEOUT_MS = 500;
const LAZY_UPDATE_ROOT_MARGIN_PX = 300;

export const pendingUpdates = new Map<string, {
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
    // Dropping the entry is safe: the poll kept the previous snapshot for deferred videos, so the
    // change re-detects and re-schedules on the next poll.
    if (isSwapHeldOffByHover({
      elItem,
      fresh,
      previous
    })) {
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

  intersectionObserver = new IntersectionObserver(entries => {
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
      const isAlreadyConsumedByDuplicate = !pending;
      if (isAlreadyConsumedByDuplicate) {
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

    const isBatchFlushPending = pendingApplyBatch.length > 0 && !isIdleCallbackScheduled;
    if (isBatchFlushPending) {
      isIdleCallbackScheduled = true;
      requestIdleCallback(flushApplyBatch, { timeout: IDLE_CALLBACK_TIMEOUT_MS });
    }
  }, { rootMargin: `0px 0px ${LAZY_UPDATE_ROOT_MARGIN_PX}px 0px` });
  return intersectionObserver;
}

export function resetObserverState() {
  pendingUpdates.clear();
  pendingApplyBatch.length = 0;
  isIdleCallbackScheduled = false;
  intersectionObserver?.disconnect();
  intersectionObserver = null;
}
