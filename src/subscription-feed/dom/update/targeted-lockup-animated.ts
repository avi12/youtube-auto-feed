import type { PolymerElement } from "../../types/polymer";
import type { VideoSnapshot } from "../../types/video";
import { applyWithDissolve } from "./dissolve";
import { mutateLockupMetadata } from "./lockup-model";
import { rebuildPolymerRenderer } from "./polymer-rebuild";
import { applyLockupTextChanges, changingLockupTextElements, collectLockupTextElements } from "./text-fields";
import { applyProgressBarUpdate, dissolveThumbnail, prepareThumbnailDissolve } from "./thumbnail";

interface AnimatedLockupChangesParams {
  videoId: string;
  elItem: PolymerElement;
  elLockup: HTMLElement;
  elImg: HTMLImageElement | null;
  freshRawRenderer: VideoSnapshot["rawRenderer"];
  freshLockup: Parameters<typeof mutateLockupMetadata>[0]["incoming"] | null;
  refs: ReturnType<typeof collectLockupTextElements>;
  fresh: VideoSnapshot;
  textElements: ReturnType<typeof changingLockupTextElements>;
  thumbWork: Awaited<ReturnType<typeof prepareThumbnailDissolve>> | null;
  isWatchProgressChanged: boolean;
}

export function applyAnimatedLockupChanges({
  videoId,
  elItem,
  elLockup,
  elImg,
  freshRawRenderer,
  freshLockup,
  refs,
  fresh,
  textElements,
  thumbWork,
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
          preserveContentImage: !thumbWork?.willDissolve
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
      forcePreserveContentImage: !thumbWork?.willDissolve
    });
  }

  if (thumbWork?.willDissolve && elImg) {
    dissolveThumbnail(elImg, thumbWork.newUrl).catch(() => {});
  }
}
