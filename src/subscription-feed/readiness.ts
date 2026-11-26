import { createGuard } from "@/shared/zod-guard";

import { GRID_SELECTOR, RICH_ITEM_SELECTOR } from "./dom/mirror/mirror-constants";
import type { PolymerElement } from "./types/polymer";
import { isPolymerElement } from "./utils/polymer";
import { isChannelVideoPlayerRenderer, isRichGridData } from "./youtube-api/guards";
import { gridVideoDataSchema, richItemDataSchema } from "./youtube-api/schemas";

const isRichItemData = createGuard(richItemDataSchema);
const isGridVideoData = createGuard(gridVideoDataSchema);

export function isDomContentReady() {
  const elShelf = document.querySelector<HTMLElement>("ytd-rich-shelf-renderer");
  if (elShelf) {
    const elItem = elShelf.querySelector<PolymerElement>(RICH_ITEM_SELECTOR);
    const isShelfItemHydrated = !!elItem && isRichItemData(elItem.data);
    if (isShelfItemHydrated) {
      return true;
    }
  }

  const elGridContents = document.querySelector("ytd-rich-grid-renderer > #contents");
  if (elGridContents) {
    for (const elChild of elGridContents.children) {
      const isHydratedGridItem =
        elChild.tagName === "YTD-RICH-ITEM-RENDERER" && isPolymerElement(elChild) && isRichItemData(elChild.data);
      if (isHydratedGridItem) {
        return true;
      }
    }
  }

  const elGrid = document.querySelector<PolymerElement>(GRID_SELECTOR);
  if (elGrid) {
    if (isRichGridData(elGrid.data)) {
      const { contents } = elGrid.data;
      const isContentsPresent = Array.isArray(contents) && contents.length > 0;
      if (isContentsPresent) {
        return true;
      }
    }
  }

  const elGridItem = document.querySelector<PolymerElement>("ytd-grid-video-renderer");
  return !!elGridItem && isGridVideoData(elGridItem.data);
}

// Readiness for the page-agnostic metadata updater: the subscriptions/rich grid is hydrated, or a
// channel-page trailer is. Pages with nothing updatable (search, watch) stay not-ready, so the light
// monitor never starts there and never fetches HTML it cannot use.
export function isGenericContentReady() {
  if (isDomContentReady()) {
    return true;
  }

  const elTrailer = document.querySelector<PolymerElement>("ytd-channel-video-player-renderer");
  return !!elTrailer && isChannelVideoPlayerRenderer(elTrailer.data);
}
