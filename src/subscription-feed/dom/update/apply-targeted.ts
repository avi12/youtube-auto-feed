import { z } from "../../../shared/zod";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import type { VideoSnapshot } from "../../types/video";
import { richItemContentSchema } from "../../youtube-api/schemas";
import { isThumbnailChanged, isThumbnailUrlRotated } from "../rich-item";
import { rebuildPolymerRenderer } from "./polymer-rebuild";
import { applyTargetedGenericUpdate } from "./targeted-generic";
import { applyTargetedLockupUpdate } from "./targeted-lockup";
import { isTileHovered } from "./thumbnail";
import { applyTrailerUpdate } from "./trailer-update";

const CHANNEL_TRAILER_TAG = "YTD-CHANNEL-VIDEO-PLAYER-RENDERER";

// Targeted path: patches specific DOM nodes (text spans, <img>, progress bar) to avoid thumbnail
// flicker and reflow. Two flavours: lockup (new UI) and legacy/shorts. Both fall back to a full
// Polymer rebuild when the <img> or progress bar can't be located.

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

type IsSwapHeldOffByHoverParams = Prettify<Omit<ApplyUpdateParams, "videoId">>;

// A hovered tile's thumbnail swap is held off so the hover preview is not disrupted. Callers defer
// the whole update (instead of applying without the swap), keeping the previous snapshot so the next
// poll retries and the swap crossfades in once the pointer leaves.
export function isSwapHeldOffByHover({ elItem, fresh, previous }: IsSwapHeldOffByHoverParams) {
  if (!previous || !isTileHovered(elItem)) {
    return false;
  }

  const urls = {
    previousUrl: previous.thumbnailUrl,
    freshUrl: fresh.thumbnailUrl,
    freshStatus: fresh.status
  };
  return isThumbnailChanged(urls) || isThumbnailUrlRotated(urls);
}

export function applyUpdate({ videoId, elItem, fresh, previous }: ApplyUpdateParams) {
  // The channel trailer is not a grid tile - it has no `content` renderer and patches its own
  // title/meta text nodes directly, so it never reaches the lockup/legacy/rebuild branches below.
  if (elItem.tagName === CHANNEL_TRAILER_TAG) {
    applyTrailerUpdate({
      elTrailer: elItem,
      fresh
    });
    return;
  }

  const { rawRenderer } = fresh;
  const isChannelLiveChanged = !!previous && previous.isChannelLive !== fresh.isChannelLive;
  const isFullRebuildNeeded = !previous || previous.status !== fresh.status || isChannelLiveChanged;
  if (isFullRebuildNeeded) {
    // Only the channel-live flag changed - thumbnail bytes are the same, preserve them.
    const isOnlyChannelLiveFlip = isChannelLiveChanged && previous !== undefined && previous.status === fresh.status;
    rebuildPolymerRenderer({
      videoId,
      elItem,
      rawRenderer,
      forcePreserveContentImage: isOnlyChannelLiveFlip
    });
    return;
  }

  const itemDataParse = itemDataSchema.safeParse(elItem.data);
  if (!itemDataParse.success) {
    rebuildPolymerRenderer({
      videoId,
      elItem,
      rawRenderer
    });
    return;
  }

  const { content } = itemDataParse.data;
  const isLockupContentPresent = content?.lockupViewModel !== undefined;
  const elLockup = isLockupContentPresent ? elItem.querySelector<HTMLElement>("yt-lockup-view-model") : null;
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
