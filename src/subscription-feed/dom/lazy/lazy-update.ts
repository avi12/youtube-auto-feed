import { findItemElements } from "@/subscription-feed/dom/query/query";
import type { Prettify } from "@/subscription-feed/types/prettify";
import type { VideoSnapshot } from "@/subscription-feed/types/video";

import { ensureObserver, pendingUpdates, resetObserverState } from "./lazy-update-observer";

type ScheduleLazyUpdateParams = Prettify<{
  videoId: string;
  fresh: Prettify<VideoSnapshot>;
  previous?: Prettify<VideoSnapshot>;
  elItemHint?: HTMLElement;
}>;

export function scheduleLazyUpdate({ videoId, fresh, previous, elItemHint }: ScheduleLazyUpdateParams) {
  const existingPending = pendingUpdates.get(videoId);
  const elItems = existingPending?.elItems ?? new Set<HTMLElement>();
  pendingUpdates.set(videoId, {
    fresh,
    previous: existingPending?.previous ?? previous,
    elItems
  });
  const observer = ensureObserver();
  for (const elItem of elItemHint ? [elItemHint] : findItemElements(videoId)) {
    elItems.add(elItem);
    observer.observe(elItem);
  }
}

export function resetLazyUpdates() {
  resetObserverState();
}
