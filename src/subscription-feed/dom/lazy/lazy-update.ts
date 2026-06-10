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
  pendingUpdates.set(videoId, {
    fresh,
    previous: existingPending?.previous ?? previous
  });
  const elItems = elItemHint ? [elItemHint] : findItemElements(videoId);
  const observer = ensureObserver();
  for (const elItem of elItems) {
    observer.observe(elItem);
  }
}

export function resetLazyUpdates() {
  resetObserverState();
}
