import { z } from "../../../shared/zod";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import type { VideoSnapshot } from "../../types/video";
import { richItemContentSchema } from "../../youtube-api/schemas";
import { rebuildPolymerRenderer } from "./polymer-rebuild";
import { applyTargetedGenericUpdate } from "./targeted-generic";
import { applyTargetedLockupUpdate } from "./targeted-lockup";

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

export function applyUpdate({ videoId, elItem, fresh, previous }: ApplyUpdateParams) {
  const { rawRenderer } = fresh;
  const isChannelLiveChanged = !!previous && previous.isChannelLive !== fresh.isChannelLive;
  const needsFullRebuild = !previous || previous.status !== fresh.status || isChannelLiveChanged;
  if (needsFullRebuild) {
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
