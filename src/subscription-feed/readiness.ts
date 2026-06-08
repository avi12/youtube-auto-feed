import { z } from "../shared/zod";
import { isPolymerElement } from "./utils/polymer";

const polymerDataSchema = z.looseObject({});

const polymerDataWithContentsSchema = z.looseObject({
  contents: z.array(z.looseObject({}))
});

// Polymer hydrates `data` asynchronously. Any one of these signals confirms the feed is safe to
// read/mutate. Called in a MutationObserver loop on initial load and each SPA nav to the feed.
export function isDomContentReady() {
  const elShelf = document.querySelector<HTMLElement>("ytd-rich-shelf-renderer");
  if (elShelf) {
    const elItem = elShelf.querySelector<HTMLElement>("ytd-rich-item-renderer");
    const isShelfItemHydrated = !!elItem && isPolymerElement(elItem)
      && polymerDataSchema.safeParse(elItem.data).success;
    if (isShelfItemHydrated) {
      return true;
    }
  }

  const elGridContents = document.querySelector("ytd-rich-grid-renderer > #contents");
  if (elGridContents) {
    for (const elChild of elGridContents.children) {
      const isHydratedGridItem = elChild.tagName === "YTD-RICH-ITEM-RENDERER"
        && isPolymerElement(elChild)
        && polymerDataSchema.safeParse(elChild.data).success;
      if (isHydratedGridItem) {
        return true;
      }
    }
  }

  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (elGrid && isPolymerElement(elGrid)) {
    const dataParsed = polymerDataWithContentsSchema.safeParse(elGrid.data);
    if (dataParsed.success) {
      const { contents } = dataParsed.data;
      const hasContents = Array.isArray(contents) && contents.length > 0;
      if (hasContents) {
        return true;
      }
    }
  }

  const elGridItem = document.querySelector<HTMLElement>("ytd-grid-video-renderer");
  return !!elGridItem && isPolymerElement(elGridItem) && polymerDataSchema.safeParse(elGridItem.data).success;
}
