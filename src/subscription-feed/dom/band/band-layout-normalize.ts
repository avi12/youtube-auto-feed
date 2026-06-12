import { isPolymerElement } from "../../utils/polymer";
import { isRichShelfData } from "../../youtube-api/guards";
import { richItemDataSchema } from "../../youtube-api/schemas";
import { videoIdFromRichItem } from "../rich-item";

function waitForPolymerToFinishRendering() {
  return new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export async function normalizeCollapsedShelfRows() {
  const trimmedVideoIds = new Set<string>();
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    if (!isRichShelfData(elShelf.data)) {
      continue;
    }

    const isCollapsedShelf = elShelf.data.isExpanded === false;
    if (!isCollapsedShelf) {
      continue;
    }

    await waitForPolymerToFinishRendering();

    const elItems = [...elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")];
    const visibleItems = elItems.filter(elItem => elItem.offsetWidth > 0);
    if (visibleItems.length === 0) {
      continue;
    }

    const firstRowTop = Math.round(visibleItems[0].getBoundingClientRect().top);
    const overflowItems = visibleItems.filter(
      elItem => Math.round(elItem.getBoundingClientRect().top) !== firstRowTop
    );
    if (overflowItems.length === 0) {
      continue;
    }

    const overflowVideoIds = new Set(
      overflowItems.flatMap(elItem => {
        if (!isPolymerElement(elItem)) {
          return [];
        }

        const itemDataParsed = richItemDataSchema.safeParse(elItem.data);
        if (!itemDataParsed.success) {
          return [];
        }

        const videoId = videoIdFromRichItem(itemDataParsed.data);
        return videoId ? [videoId] : [];
      })
    );

    const { contents: currentContents = [] } = elShelf.data;
    const normalizedContents = currentContents.filter(item => {
      const videoId = videoIdFromRichItem(item);
      const isOverflowItem = !!videoId && overflowVideoIds.has(videoId);
      if (isOverflowItem) {
        trimmedVideoIds.add(videoId);
        return false;
      }

      return true;
    });

    elShelf.set("data.contents", normalizedContents);
  }
  return trimmedVideoIds;
}
