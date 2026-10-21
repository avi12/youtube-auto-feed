import type { Prettify } from "../../types/prettify";
import type { VideoSnapshot } from "../../types/video";
import { findItemElements } from "../query/query";
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
