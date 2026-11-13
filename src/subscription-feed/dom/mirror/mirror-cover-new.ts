import { isInViewport } from "@/subscription-feed/dom/animations";
import type { Prettify } from "@/subscription-feed/types/prettify";
import { isPolymerElement } from "@/subscription-feed/utils/polymer";
import { videoIdFromData } from "@/subscription-feed/utils/video-id";

import { GRID_ITEM_SELECTOR } from "./mirror-constants";
import { thumbnailContainerInItem } from "./mirror-elements";
import { addCoverOverlay, dropOverlayWhenThumbnailLoads, prepareCoverHost } from "./mirror-overlay";

type CoverNewTilesParams = Prettify<{
  newlyInsertedIds: Set<string>;
  newThumbnailUrls: Map<string, string>;
}>;

// New tiles slide in via the entrance animation, which preCoverReflowImages skips, so they get their
// preloaded thumbnail as a z-index:-1 overlay to bridge the gap while the real <img> decodes.
export function coverNewlyInsertedTiles({ newlyInsertedIds, newThumbnailUrls }: CoverNewTilesParams) {
  if (newlyInsertedIds.size === 0) {
    return;
  }

  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    const isNotCoverCandidate = !isInViewport(elItem) || !isPolymerElement(elItem);
    if (isNotCoverCandidate) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    const thumbnailUrl = videoId ? newThumbnailUrls.get(videoId) : "";
    const elThumbnail = thumbnailContainerInItem(elItem);
    if (!videoId || !newlyInsertedIds.has(videoId) || !thumbnailUrl || !elThumbnail) {
      continue;
    }

    prepareCoverHost(elItem);
    const elOverlay = addCoverOverlay({
      elItem,
      url: thumbnailUrl,
      rect: elThumbnail.getBoundingClientRect(),
      tileRect: elItem.getBoundingClientRect(),
      radius: getComputedStyle(elThumbnail).borderRadius
    });
    dropOverlayWhenThumbnailLoads({
      elItem,
      elOverlay
    });
  }
}
