import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { videoIdFromData } from "../../utils/video-id";
import { isInViewport } from "../animations";
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
    if (!isInViewport(elItem) || !isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    const thumbnailUrl = videoId ? newThumbnailUrls.get(videoId) : "";
    const elThumbnail = thumbnailContainerInItem(elItem);
    if (!videoId || !newlyInsertedIds.has(videoId) || !thumbnailUrl || !elThumbnail) {
      continue;
    }

    prepareCoverHost(elItem);
    const thumbnailRadius = getComputedStyle(elThumbnail).borderRadius;
    const elOverlay = addCoverOverlay(
      elItem,
      thumbnailUrl,
      elThumbnail.getBoundingClientRect(),
      elItem.getBoundingClientRect(),
      thumbnailRadius
    );
    dropOverlayWhenThumbnailLoads(elItem, elOverlay);
  }
}
