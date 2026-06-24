import type { Prettify } from "../../types/prettify";
import { isLockupViewModel } from "../../youtube-api/guards";
import { isThumbnailChanged } from "../rich-item";
import { rebuildPolymerRenderer } from "./polymer-rebuild";
import { applyAnimatedLockupChanges } from "./targeted-lockup-animated";
import { applyStaticLockupChanges } from "./targeted-lockup-static";
import type { TargetedUpdateParams } from "./targeted-types";
import { changingLockupTextElements, collectLockupTextElements } from "./text-fields";
import { findThumbnailImg, isTileHovered, swapThumbnailInPlace } from "./thumbnail";

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
  const isThumbnailUrlDifferent = isThumbnailChanged({
    previousUrl: previous.thumbnailUrl,
    freshUrl: thumbnailUrl,
    freshStatus: fresh.status
  });
  const elImg = isThumbnailUrlDifferent ? findThumbnailImg(elLockup) : null;
  // Thumbnail changed but <img> not found - rebuild the whole renderer.
  const isThumbnailReachable = !isThumbnailUrlDifferent || !!elImg;
  if (!isThumbnailReachable) {
    rebuildPolymerRenderer({
      videoId,
      elItem,
      rawRenderer: freshRawRenderer
    });
    return;
  }

  // The refreshed picture is swapped in instantly (no crossfade), preloaded so it lands already decoded,
  // held off while hovering so the hover preview is not disrupted.
  const isThumbnailSwapping = !!elImg && !isTileHovered(elItem);
  if (isThumbnailSwapping && elImg) {
    await swapThumbnailInPlace(elImg, newUrl);
  }

  const isWatchProgressChanged = previous.watchProgressPercent !== watchProgressPercent;
  const isAnimatable = textElements.length > 0 || isThumbnailSwapping;
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
    freshRawRenderer,
    freshLockup,
    refs,
    fresh,
    textElements,
    isThumbnailSwapping,
    isWatchProgressChanged
  });
}
