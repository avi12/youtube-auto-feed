import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import type { VideoSnapshot } from "../../types/video";
import { isRecord } from "../../utils/records";
import { isLockupViewModel } from "../../youtube-api/guards";
import { applyWithDissolve } from "./dissolve";
import { mutateLockupMetadata } from "./lockup-model";
import { applyPolymerUpdate, syncGridModelItem } from "./polymer-model";
import {
  applyLockupTextChanges,
  changingLegacyTextElements,
  changingLockupTextElements,
  changingShortsTextElements,
  collectLockupTextElements,
  updateLegacyRendererTextFields,
  updateShortsTextFields
} from "./text-fields";
import {
  applyProgressBarUpdate,
  dissolveThumbnail,
  findThumbnailImg,
  findThumbnailImgInItem,
  prepareThumbnailDissolve
} from "./thumbnail";

// The "targeted" path patches specific DOM nodes (text spans, <img>, progress bar) so the
// already-loaded thumbnail bytes don't flicker and the page doesn't reflow. There are two
// flavours: lockup (new UI) and legacy/shorts (everything else). Both fall back to a full
// Polymer rebuild when they can't locate the <img> or progress bar.

interface TargetedUpdateParams {
  videoId: string;
  elItem: PolymerElement;
  previous: VideoSnapshot;
  fresh: VideoSnapshot;
}

type ApplyTargetedGenericUpdateParams = Prettify<TargetedUpdateParams>;

async function applyTargetedGenericUpdate({
  videoId,
  elItem,
  previous,
  fresh
}: ApplyTargetedGenericUpdateParams) {
  const { rawRenderer, thumbnailUrl } = fresh;
  const isShorts = !!elItem.querySelector("ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model");
  const textElements = isShorts
    ? changingShortsTextElements({
      elItem,
      fresh
    })
    : changingLegacyTextElements({
      elItem,
      fresh
    });
  const applyText = isShorts
    ? () => updateShortsTextFields({
      elItem,
      fresh
    })
    : () => updateLegacyRendererTextFields({
      elItem,
      fresh
    });

  const isThumbnailChanging = previous.thumbnailUrl !== thumbnailUrl;
  const elImg = isThumbnailChanging ? findThumbnailImgInItem(elItem) : null;
  // Thumbnail changed but the live <img> couldn't be located, so rebuild the whole renderer.
  if (isThumbnailChanging && !elImg) {
    applyPolymerUpdate({
      elItem,
      rawRenderer
    });
    syncGridModelItem({
      videoId,
      rawRenderer
    });
    return;
  }

  const thumbWork = elImg
    ? await prepareThumbnailDissolve({
      elItem,
      elImg,
      newUrl: thumbnailUrl
    })
    : null;
  const isAnimatable = textElements.length > 0 || !!thumbWork?.willDissolve;
  if (!isAnimatable) {
    // Thumbnail bytes are identical though URL changed; sync the model but keep DOM <img> alone.
    if (elImg && isThumbnailChanging) {
      syncGridModelItem({
        videoId,
        rawRenderer,
        forcePreserveContentImage: true
      });
    }

    return;
  }

  applyWithDissolve({
    elements: [...textElements],
    apply() {
      applyText();
      syncGridModelItem({
        videoId,
        rawRenderer,
        forcePreserveContentImage: !thumbWork?.willDissolve
      });
    }
  });

  if (thumbWork?.willDissolve && elImg) {
    dissolveThumbnail(elImg, thumbWork.newUrl).catch(() => {});
  }
}

type ApplyTargetedLockupUpdateParams = Prettify<TargetedUpdateParams & {
  elLockup: HTMLElement;
}>;

interface StaticLockupChangesParams {
  videoId: string;
  elItem: PolymerElement;
  elLockup: HTMLElement;
  freshRawRenderer: VideoSnapshot["rawRenderer"];
  freshLockup: Parameters<typeof mutateLockupMetadata>[0]["incoming"] | null;
  watchProgressPercent: VideoSnapshot["watchProgressPercent"];
  isWatchProgressChanged: boolean;
}

function applyStaticLockupChanges({
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

  if (!isWatchProgressChanged) return;

  const didUpdate = applyProgressBarUpdate({
    elLockup,
    percent: watchProgressPercent
  });
  if (!didUpdate) {
    applyPolymerUpdate({
      elItem,
      rawRenderer: freshRawRenderer
    });
    syncGridModelItem({
      videoId,
      rawRenderer: freshRawRenderer,
      forcePreserveContentImage: true
    });
  }
}

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

function applyAnimatedLockupChanges({
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
    applyPolymerUpdate({
      elItem,
      rawRenderer: freshRawRenderer
    });
    syncGridModelItem({
      videoId,
      rawRenderer: freshRawRenderer,
      forcePreserveContentImage: !thumbWork?.willDissolve
    });
  }

  if (thumbWork?.willDissolve && elImg) {
    dissolveThumbnail(elImg, thumbWork.newUrl).catch(() => {});
  }
}

async function applyTargetedLockupUpdate({
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
  // Thumbnail changed but the live <img> couldn't be located, so rebuild the whole renderer.
  const isThumbnailReachable = !thumbUrlDiffers || !!elImg;
  if (!isThumbnailReachable) {
    applyPolymerUpdate({
      elItem,
      rawRenderer: freshRawRenderer
    });
    syncGridModelItem({
      videoId,
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

// `applyUpdate` is the dispatch point. It decides whether to do a full Polymer rebuild
// (status flips, channel-live flips, or anything else that can't be patched in place) or to
// take the targeted lockup/generic path. Status changes always rebuild because targeted patches
// only know how to update metadata, not change the renderer kind.
type ApplyUpdateParams = Prettify<{
  videoId: string;
  elItem: PolymerElement;
  fresh: Prettify<VideoSnapshot>;
  previous?: Prettify<VideoSnapshot>;
}>;

export function applyUpdate({ videoId, elItem, fresh, previous }: ApplyUpdateParams) {
  const { rawRenderer } = fresh;
  const isChannelLiveChanged = !!previous && previous.isChannelLive !== fresh.isChannelLive;
  const needsFullRebuild = !previous || previous.status !== fresh.status || isChannelLiveChanged;
  if (needsFullRebuild) {
    applyPolymerUpdate({
      elItem,
      rawRenderer
    });
    // When only the channel-live flag changed, the thumbnail bytes are the same - keep them.
    const isOnlyChannelLiveFlip = isChannelLiveChanged && previous !== undefined && previous.status === fresh.status;
    syncGridModelItem({
      videoId,
      rawRenderer,
      forcePreserveContentImage: isOnlyChannelLiveFlip
    });
    return;
  }

  const itemData = elItem.data;
  if (!isRecord(itemData)) {
    applyPolymerUpdate({
      elItem,
      rawRenderer
    });
    syncGridModelItem({
      videoId,
      rawRenderer
    });
    return;
  }

  const { content } = itemData;
  const hasLockupContent = isRecord(content) && isRecord(content.lockupViewModel);
  const elLockup = hasLockupContent ? elItem.querySelector<HTMLElement>("yt-lockup-view-model") : null;
  if (elLockup) {
    applyTargetedLockupUpdate({
      videoId,
      elItem,
      elLockup,
      previous,
      fresh
    }).catch(() => {});
    return;
  }

  applyTargetedGenericUpdate({
    videoId,
    elItem,
    previous,
    fresh
  }).catch(() => {});
}
