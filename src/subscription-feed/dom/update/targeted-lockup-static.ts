import type { PolymerElement } from "../../types/polymer";
import type { VideoSnapshot } from "../../types/video";
import { mutateLockupMetadata } from "./lockup-model";
import { rebuildPolymerRenderer } from "./polymer-rebuild";
import { applyProgressBarUpdate } from "./thumbnail";

interface StaticLockupChangesParams {
  videoId: string;
  elItem: PolymerElement;
  elLockup: HTMLElement;
  freshRawRenderer: VideoSnapshot["rawRenderer"];
  freshLockup: Parameters<typeof mutateLockupMetadata>[0]["incoming"] | null;
  watchProgressPercent: VideoSnapshot["watchProgressPercent"];
  isWatchProgressChanged: boolean;
}

export function applyStaticLockupChanges({
  videoId,
  elItem,
  elLockup,
  freshRawRenderer,
  freshLockup,
  watchProgressPercent,
  isWatchProgressChanged
}: StaticLockupChangesParams) {
  if (freshLockup) {
    mutateLockupMetadata({
      videoId,
      elItem,
      incoming: freshLockup,
      preserveContentImage: true
    });
  }

  if (!isWatchProgressChanged) {
    return;
  }

  const isProgressBarUpdated = applyProgressBarUpdate({
    elLockup,
    percent: watchProgressPercent
  });
  if (!isProgressBarUpdated) {
    rebuildPolymerRenderer({
      videoId,
      elItem,
      rawRenderer: freshRawRenderer,
      forcePreserveContentImage: true
    });
  }
}
