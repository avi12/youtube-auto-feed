import { isPolymerElement } from "./utils/polymer";
import { gridDataSchema, gridVideoDataSchema, richItemDataSchema } from "./youtube-api/schemas";

export function isDomContentReady() {
  const elShelf = document.querySelector<HTMLElement>("ytd-rich-shelf-renderer");
  if (elShelf) {
    const elItem = elShelf.querySelector<HTMLElement>("ytd-rich-item-renderer");
    const isShelfItemHydrated = !!elItem && isPolymerElement(elItem)
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

  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (elGrid && isPolymerElement(elGrid)) {
    const gridDataParsed = gridDataSchema.safeParse(elGrid.data);
    if (gridDataParsed.success) {
      const { contents } = gridDataParsed.data;
      const hasContents = Array.isArray(contents) && contents.length > 0;
      if (hasContents) {
        return true;
      }
    }
  }

  const elGridItem = document.querySelector<HTMLElement>("ytd-grid-video-renderer");
  return !!elGridItem && isPolymerElement(elGridItem) && gridVideoDataSchema.safeParse(elGridItem.data).success;
}
