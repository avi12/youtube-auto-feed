import type { PolymerElement } from "./types/polymer";
import { isPolymerElement } from "./utils/polymer";
import {
  channelVideoPlayerRendererSchema,
  gridDataSchema,
  gridVideoDataSchema,
  richItemDataSchema
} from "./youtube-api/schemas";

export function isDomContentReady() {
  const elShelf = document.querySelector<HTMLElement>("ytd-rich-shelf-renderer");
  if (elShelf) {
    const elItem = elShelf.querySelector<PolymerElement>("ytd-rich-item-renderer");
    const isShelfItemHydrated = !!elItem
      && richItemDataSchema.safeParse(elItem.data).success;
    if (isShelfItemHydrated) {
      return true;
    }
  }

  const elGridContents = document.querySelector("ytd-rich-grid-renderer > #contents");
  if (elGridContents) {
    for (const elChild of elGridContents.children) {
      const isHydratedGridItem = elChild.tagName === "YTD-RICH-ITEM-RENDERER"
        && isPolymerElement(elChild)
        && richItemDataSchema.safeParse(elChild.data).success;
      if (isHydratedGridItem) {
        return true;
      }
    }
  }

  const elGrid = document.querySelector<PolymerElement>("ytd-rich-grid-renderer");
  if (elGrid) {
    const gridDataParsed = gridDataSchema.safeParse(elGrid.data);
    if (gridDataParsed.success) {
      const { contents } = gridDataParsed.data;
      const isContentsPresent = Array.isArray(contents) && contents.length > 0;
      if (isContentsPresent) {
        return true;
      }
    }
  }

  const elGridItem = document.querySelector<PolymerElement>("ytd-grid-video-renderer");
  return !!elGridItem && gridVideoDataSchema.safeParse(elGridItem.data).success;
}

// Readiness for the page-agnostic metadata updater: the subscriptions/rich grid is hydrated, or a
// channel-page trailer is. Pages with nothing updatable (search, watch) stay not-ready, so the light
// monitor never starts there and never fetches HTML it cannot use.
export function isGenericContentReady() {
  if (isDomContentReady()) {
    return true;
  }

  const elTrailer = document.querySelector<PolymerElement>("ytd-channel-video-player-renderer");
  return !!elTrailer && channelVideoPlayerRendererSchema.safeParse(elTrailer.data).success;
}
