import { isPolymerElement } from "./utils/polymer";
import { isRecord } from "./utils/records";

// Polymer hydrates `data` asynchronously after the page loads. Any one of these signals confirms
// the feed is wired up and safe to read/mutate. The monitor calls this in a MutationObserver loop
// during initial page load (and after each SPA navigation back to /feed/subscriptions).
export function isDomContentReady() {
  const elShelf = document.querySelector<HTMLElement>("ytd-rich-shelf-renderer");
  if (elShelf) {
    const elItem = elShelf.querySelector<HTMLElement>("ytd-rich-item-renderer");
    const isShelfItemHydrated = !!elItem && isPolymerElement(elItem) && isRecord(elItem.data);
    if (isShelfItemHydrated) {
      return true;
    }
  }

  const elGridContents = document.querySelector("ytd-rich-grid-renderer > #contents");
  if (elGridContents) {
    for (const elChild of elGridContents.children) {
      const isHydratedGridItem = elChild.tagName === "YTD-RICH-ITEM-RENDERER"
        && isPolymerElement(elChild)
        && isRecord(elChild.data);
      if (isHydratedGridItem) {
        return true;
      }
    }
  }

  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data)) {
    const { contents } = elGrid.data;
    const hasContents = Array.isArray(contents) && contents.length > 0;
    if (hasContents) {
      return true;
    }
  }

  const elGridItem = document.querySelector<HTMLElement>("ytd-grid-video-renderer");
  return !!elGridItem && isPolymerElement(elGridItem) && isRecord(elGridItem.data);
}
