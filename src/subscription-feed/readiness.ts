import type { PolymerElement } from "./types/polymer";
import { isPolymerElement } from "./utils/polymer";
import { gridDataSchema, gridVideoDataSchema, richItemDataSchema } from "./youtube-api/schemas";

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
      const hasContents = Array.isArray(contents) && contents.length > 0;
      if (hasContents) {
        return true;
      }
    }
  }

  const elGridItem = document.querySelector<PolymerElement>("ytd-grid-video-renderer");
  return !!elGridItem && gridVideoDataSchema.safeParse(elGridItem.data).success;
}
