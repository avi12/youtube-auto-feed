import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";
import { avatarUrlFromContent, thumbnailUrlFromContent, videoIdFromRichItem } from "../rich-item";
import { GRID_ITEM_SELECTOR } from "./mirror-constants";
import { avatarImgInItem, isInReflowZone, thumbnailContainerInItem } from "./mirror-elements";
import { addCoverOverlay, clearReflowImageCovers, prepareCoverHost } from "./mirror-overlay";

export { clearReflowImageCovers };

// Each tile node (ytd-rich-item-renderer) is stable but YouTube swaps its inner image containers on
// some rebinds, so the z-index:-1 overlay is pinned to the tile node, showing through only while the
// rebound image is briefly blank.
export function preCoverReflowImages(newContents: Prettify<InnerTubeRichGridItem>[], newlyInsertedIds: Set<string>) {
  const futureItems = newContents.filter(item => !!item.richItemRenderer);
  const elItems = [...document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)];
  const coverableCount = Math.min(elItems.length, futureItems.length);
  for (let i = 0; i < coverableCount; i++) {
    const elItem = elItems[i];
    const futureContent = futureItems[i].richItemRenderer?.content;
    if (!isInReflowZone(elItem) || !futureContent) {
      continue;
    }

    const futureVideoId = videoIdFromRichItem(futureItems[i]);
    if (futureVideoId && newlyInsertedIds.has(futureVideoId)) {
      continue;
    }

    const elThumbnail = thumbnailContainerInItem(elItem);
    const elAvatar = avatarImgInItem(elItem);
    const thumbnailUrl = thumbnailUrlFromContent(futureContent);
    const avatarUrl = avatarUrlFromContent(futureContent);
    if ((!elThumbnail || !thumbnailUrl) && (!elAvatar || !avatarUrl)) {
      continue;
    }

    prepareCoverHost(elItem);
    const tileRect = elItem.getBoundingClientRect();
    if (elThumbnail && thumbnailUrl) {
      const thumbnailRadius = getComputedStyle(elThumbnail).borderRadius;
      addCoverOverlay(elItem, thumbnailUrl, elThumbnail.getBoundingClientRect(), tileRect, thumbnailRadius);
    }

    if (elAvatar && avatarUrl) {
      addCoverOverlay(elItem, avatarUrl, elAvatar.getBoundingClientRect(), tileRect, "50%");
    }
  }
}
