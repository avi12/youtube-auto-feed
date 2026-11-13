import type { PolymerElement } from "@/subscription-feed/types/polymer";
import { isRichGridData, isRichShelfData } from "@/subscription-feed/youtube-api/guards";
import { GRID_SELECTOR } from "@/subscription-feed/dom/mirror/mirror-constants";
import { findRichItemIndex } from "@/subscription-feed/dom/rich-item";
import { applyRichItemContentUpdate } from "./polymer-renderer-merge";
import type { ApplyToContainerParams } from "./polymer-sync-types";

export { applyToLegacyShelfModels } from "./polymer-sync-legacy";

type UpdateRichItemParams = ApplyToContainerParams & {
  elElement: PolymerElement;
};

function updateRichItem({ elElement, videoId, rawRenderer, forcePreserveContentImage }: UpdateRichItemParams) {
  if (!isRichGridData(elElement.data) && !isRichShelfData(elElement.data)) {
    return;
  }

  const { contents = [] } = elElement.data;
  const iItem = findRichItemIndex({
    contents,
    videoId
  });
  const existingContent = iItem < 0 ? undefined : contents[iItem]?.richItemRenderer?.content;
  if (!existingContent) {
    return;
  }

  applyRichItemContentUpdate({
    elElement,
    basePath: `data.contents.${iItem}.richItemRenderer.content`,
    existingContent,
    rawRenderer,
    forcePreserveContentImage
  });
}

export function applyToGridModel({ videoId, rawRenderer, forcePreserveContentImage }: ApplyToContainerParams) {
  const elGrid = document.querySelector<PolymerElement>(GRID_SELECTOR);
  if (!elGrid) {
    return;
  }

  updateRichItem({
    elElement: elGrid,
    videoId,
    rawRenderer,
    forcePreserveContentImage
  });
}

export function applyToRichShelfModels({ videoId, rawRenderer, forcePreserveContentImage }: ApplyToContainerParams) {
  for (const elShelf of document.querySelectorAll<PolymerElement>("ytd-rich-shelf-renderer")) {
    updateRichItem({
      elElement: elShelf,
      videoId,
      rawRenderer,
      forcePreserveContentImage
    });
  }
}
