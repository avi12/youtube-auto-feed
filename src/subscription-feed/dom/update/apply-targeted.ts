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

export async function applyTargetedGenericUpdate({ videoId, elItem, previous, fresh }: Prettify<TargetedUpdateParams>) {
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
  const isNothingToAnimate = textElements.length === 0 && !thumbWork?.willDissolve;
  if (isNothingToAnimate) {
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

  const elements = [...textElements];
  if (thumbWork?.willDissolve && elImg) {
    elements.push(elImg);
  }

  await applyWithDissolve({
    elements,
    apply() {
      applyText();

      if (thumbWork?.willDissolve && elImg) {
        elImg.src = thumbWork.newUrl;
      }

      syncGridModelItem({
        videoId,
        rawRenderer,
        forcePreserveContentImage: !thumbWork?.willDissolve
      });
    }
  });
}

export async function applyTargetedLockupUpdate({
  videoId,
  elItem,
  elLockup,
  previous,
  fresh
}: Prettify<TargetedUpdateParams> & {
  elLockup: HTMLElement;
}) {
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
  const isThumbnailUnreachable = thumbUrlDiffers && !elImg;
  if (isThumbnailUnreachable) {
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
  const isNothingToAnimate = textElements.length === 0 && !thumbWork?.willDissolve;
  if (isNothingToAnimate) {
    if (freshLockup) {
      mutateLockupMetadata({
        videoId,
        elItem,
        incoming: freshLockup,
        preserveContentImage: true
      });
    }

    if (isWatchProgressChanged) {
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

    return;
  }

  const elements = [...textElements];
  if (thumbWork?.willDissolve && elImg) {
    elements.push(elImg);
  }

  let isProgressBarDirty = false;
  await applyWithDissolve({
    elements,
    apply() {
      applyLockupTextChanges({
        refs,
        fresh
      });

      if (thumbWork?.willDissolve && elImg) {
        elImg.src = thumbWork.newUrl;
      }

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
          percent: watchProgressPercent
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
}

// `applyUpdate` is the dispatch point. It decides whether to do a full Polymer rebuild
// (status flips, channel-live flips, or anything else that can't be patched in place) or to
// take the targeted lockup/generic path. Status changes always rebuild because targeted patches
// only know how to update metadata, not change the renderer kind.
export function applyUpdate({ videoId, elItem, fresh, previous }: {
  videoId: string;
  elItem: PolymerElement;
  fresh: Prettify<VideoSnapshot>;
  previous?: Prettify<VideoSnapshot>;
}) {
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
    void applyTargetedLockupUpdate({
      videoId,
      elItem,
      elLockup,
      previous,
      fresh
    });
    return;
  }

  void applyTargetedGenericUpdate({
    videoId,
    elItem,
    previous,
    fresh
  });
}
