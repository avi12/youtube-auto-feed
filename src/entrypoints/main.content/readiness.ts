import { isPolymerElement, isRecord } from "./helpers";

export function isDomContentReady() {
  const elShelf = document.querySelector<HTMLElement>("ytd-rich-shelf-renderer");
  if (elShelf) {
    const elItem = elShelf.querySelector<HTMLElement>("ytd-rich-item-renderer");
    if (elItem && isPolymerElement(elItem) && isRecord(elItem.data)) {
      return true;
    }
  }

  const elGridContents = document.querySelector("ytd-rich-grid-renderer > #contents");
  if (elGridContents) {
    for (const elChild of elGridContents.children) {
      if (elChild.tagName === "YTD-RICH-ITEM-RENDERER" && isPolymerElement(elChild) && isRecord(elChild.data)) {
        return true;
      }
    }
  }

  // Background tabs: virtual scroller pauses rendering, but Polymer data is populated
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data)) {
    const { contents } = elGrid.data;
    if (Array.isArray(contents) && contents.length > 0) {
      return true;
    }
  }

  const elGridItem = document.querySelector<HTMLElement>("ytd-grid-video-renderer");
  return !!(elGridItem && isPolymerElement(elGridItem) && isRecord(elGridItem.data));
}
