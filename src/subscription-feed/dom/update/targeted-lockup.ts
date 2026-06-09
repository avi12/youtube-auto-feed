import type { Prettify } from "../../types/prettify";
import { isLockupViewModel } from "../../youtube-api/guards";
import { rebuildPolymerRenderer } from "./polymer-rebuild";
import { applyAnimatedLockupChanges } from "./targeted-lockup-animated";
import { applyStaticLockupChanges } from "./targeted-lockup-static";
import type { TargetedUpdateParams } from "./targeted-types";
import { changingLockupTextElements, collectLockupTextElements } from "./text-fields";
import { findThumbnailImg, prepareThumbnailDissolve } from "./thumbnail";

type ApplyTargetedLockupUpdateParams = Prettify<TargetedUpdateParams & {
  elLockup: HTMLElement;
}>;

export async function applyTargetedLockupUpdate({
  videoId,
  elItem,
  elLockup,
  previous,
  fresh
}: ApplyTargetedLockupUpdateParams) {
  const refs = collectLockupTextElements(elLockup);
  const textElements = changingLockupTextElements({
    refs,
    fresh
  });

  const { rawRenderer: freshRawRenderer, thumbnailUrl, watchProgressPercent } = fresh;
  const freshLockup = isLockupViewModel(freshRawRenderer) ? freshRawRenderer : null;
  const newUrl = freshLockup?.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url ?? thumbnailUrl;
  const thumbUrlDiffers = previous.thumbnailUrl !== thumbnailUrl;
  const elImg = thumbUrlDiffers ? findThumbnailImg(elLockup) : null;
  // Thumbnail changed but <img> not found - rebuild the whole renderer.
  const isThumbnailReachable = !thumbUrlDiffers || !!elImg;
  if (!isThumbnailReachable) {
    rebuildPolymerRenderer({
      videoId,
      elItem,
      rawRenderer: freshRawRenderer
    });
    return;
  }

  const thumbWork = elImg
    ? await prepareThumbnailDissolve({
      elItem,
      elImg,
      newUrl
    })
    : null;
  const isWatchProgressChanged = previous.watchProgressPercent !== watchProgressPercent;
  const isAnimatable = textElements.length > 0 || !!thumbWork?.willDissolve;
  if (!isAnimatable) {
    applyStaticLockupChanges({
      videoId,
      elItem,
      elLockup,
      freshRawRenderer,
      freshLockup,
      watchProgressPercent,
      isWatchProgressChanged
    });
    return;
  }

  applyAnimatedLockupChanges({
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
  });
}
