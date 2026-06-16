import type { PolymerElement } from "../../types/polymer";
import type { VideoSnapshot } from "../../types/video";
import { applyWithDissolve } from "./dissolve";
import { mutateLockupMetadata } from "./lockup-model";
import { rebuildPolymerRenderer } from "./polymer-rebuild";
import { applyLockupTextChanges, changingLockupTextElements, collectLockupTextElements } from "./text-fields";
import { applyProgressBarUpdate } from "./thumbnail";

interface AnimatedLockupChangesParams {
  videoId: string;
  elItem: PolymerElement;
  elLockup: HTMLElement;
  freshRawRenderer: VideoSnapshot["rawRenderer"];
  freshLockup: Parameters<typeof mutateLockupMetadata>[0]["incoming"] | null;
  refs: ReturnType<typeof collectLockupTextElements>;
  fresh: VideoSnapshot;
  textElements: ReturnType<typeof changingLockupTextElements>;
  isThumbnailSwapping: boolean;
  isWatchProgressChanged: boolean;
}

export function applyAnimatedLockupChanges({
  videoId,
  elItem,
  elLockup,
  freshRawRenderer,
  freshLockup,
  refs,
  fresh,
  textElements,
  isThumbnailSwapping,
  isWatchProgressChanged
}: AnimatedLockupChangesParams) {
  let isProgressBarDirty = false;
  applyWithDissolve({
    elements: [...textElements],
    apply() {
      applyLockupTextChanges({
        refs,
        fresh
      });

      if (freshLockup) {
        mutateLockupMetadata({
          videoId,
          elItem,
          incoming: freshLockup,
          preserveContentImage: !isThumbnailSwapping
        });
      }

      if (isWatchProgressChanged) {
        isProgressBarDirty = !applyProgressBarUpdate({
          elLockup,
          percent: fresh.watchProgressPercent
        });
      }
    }
  });

  if (isProgressBarDirty) {
    rebuildPolymerRenderer({
      videoId,
      elItem,
      rawRenderer: freshRawRenderer,
      forcePreserveContentImage: !isThumbnailSwapping
    });
  }
}
