import { isAnimationsEnabled } from "../../settings-state";
import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { deepArray } from "../../utils/records";
import { richShelfDataSchema } from "../../youtube-api/schemas";
import { videoIdFromRichItem } from "../rich-item";
import { animateShelfRemoval } from "./mirror-shelf-remove";

// On unsubscribe (or a video deletion) a channel's uploads vanish from the whole API response. The
// inline-band reflow drops them from the Latest band, but rich shelves (Most relevant, Shorts) keep
// their own copies and were never reconciled. Remove a shelf video once its id is absent from the
// entire fresh API, which leaves videos that merely moved between bands in place - they stay present
// somewhere in the response, so only genuinely gone uploads are pruned.

function collectApiVideoIds(apiContents: Prettify<InnerTubeRichGridItem>[]) {
  const videoIds = new Set<string>();
  for (const item of apiContents) {
    const inlineId = videoIdFromRichItem(item);
    if (inlineId) {
      videoIds.add(inlineId);
    }

    for (const shelfItem of item.richSectionRenderer?.content?.richShelfRenderer?.contents ?? []) {
      const shelfId = videoIdFromRichItem(shelfItem);
      if (shelfId) {
        videoIds.add(shelfId);
      }
    }
  }
  return videoIds;
}

export function pruneUnsubscribedShelfVideos(apiContents: Prettify<InnerTubeRichGridItem>[]) {
  if (apiContents.length === 0) {
    return;
  }

  const apiVideoIds = collectApiVideoIds(apiContents);
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf) || !richShelfDataSchema.safeParse(elShelf.data).success) {
      continue;
    }

    const contents = deepArray<InnerTubeRichGridItem>(elShelf.data, "contents");
    const removedVideoIds = new Set<string>();
    const retained = contents.filter(item => {
      const videoId = videoIdFromRichItem(item);
      const isRemoved = !!videoId && !apiVideoIds.has(videoId);
      if (isRemoved) {
        removedVideoIds.add(videoId);
      }

      return !isRemoved;
    });
    if (removedVideoIds.size === 0) {
      continue;
    }

    if (!isAnimationsEnabled()) {
      elShelf.set("data.contents", retained);
      continue;
    }

    animateShelfRemoval({
      elShelf,
      retained,
      removedVideoIds
    }).catch(() => {});
  }
}
