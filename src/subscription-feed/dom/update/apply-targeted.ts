import { z } from "../../../shared/zod";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import type { VideoSnapshot } from "../../types/video";
import { isLockupViewModel } from "../../youtube-api/guards";
import { richItemContentSchema } from "../../youtube-api/schemas";
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

// Targeted path: patches specific DOM nodes (text spans, <img>, progress bar) to avoid thumbnail
// flicker and reflow. Two flavours: lockup (new UI) and legacy/shorts. Both fall back to a full
// Polymer rebuild when the <img> or progress bar can't be located.

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
  // Thumbnail changed but <img> not found - rebuild the whole renderer.
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
    // URL changed but bytes are the same - sync the model only, leave the DOM <img> alone.
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
  // Thumbnail changed but <img> not found - rebuild the whole renderer.
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

const itemDataSchema = z.looseObject({
  content: richItemContentSchema.optional().catch(undefined)
});

// Dispatch point. Full Polymer rebuild for status/channel-live flips or missing data; targeted
// lockup/generic path for pure metadata changes. Status changes always rebuild - targeted patches
// can update metadata but can't change the renderer kind.
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
    // Only the channel-live flag changed - thumbnail bytes are the same, preserve them.
    const isOnlyChannelLiveFlip = isChannelLiveChanged && previous !== undefined && previous.status === fresh.status;
    syncGridModelItem({
      videoId,
      rawRenderer,
      forcePreserveContentImage: isOnlyChannelLiveFlip
    });
    return;
  }

  const itemDataParse = itemDataSchema.safeParse(elItem.data);
  if (!itemDataParse.success) {
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

  const { content } = itemDataParse.data;
  const hasLockupContent = content?.lockupViewModel !== undefined;
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
