import { GRID_SELECTOR } from "@/subscription-feed/dom/mirror/mirror-constants";
import { findRichItemIndex } from "@/subscription-feed/dom/rich-item";
import type { PolymerElement } from "@/subscription-feed/types/polymer";
import { isRichGridData, isRichShelfData } from "@/subscription-feed/youtube-api/guards";

import { applyRichItemContentUpdate } from "./polymer-renderer-merge";
import type { ApplyToContainerParams } from "./polymer-sync-types";

export { applyToLegacyShelfModels } from "./polymer-sync-legacy";

type UpdateRichItemParams = ApplyToContainerParams & {
  elElement: PolymerElement;
};

function updateRichItem({ elElement, videoId, rawRenderer, isContentImagePreserveForced }: UpdateRichItemParams) {
  const { data } = elElement;
  const isRichData = isRichGridData(data) || isRichShelfData(data);
  if (!isRichData) {
    return;
  }

  const { contents = [] } = data;
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
    isContentImagePreserveForced
  });
}

export function applyToGridModel({ videoId, rawRenderer, isContentImagePreserveForced }: ApplyToContainerParams) {
  const elGrid = document.querySelector<PolymerElement>(GRID_SELECTOR);
  if (!elGrid) {
    return;
  }

  updateRichItem({
    elElement: elGrid,
    videoId,
    rawRenderer,
    isContentImagePreserveForced
  });
}

export function applyToRichShelfModels({ videoId, rawRenderer, isContentImagePreserveForced }: ApplyToContainerParams) {
  for (const elShelf of document.querySelectorAll<PolymerElement>("ytd-rich-shelf-renderer")) {
    updateRichItem({
      elElement: elShelf,
      videoId,
      rawRenderer,
      isContentImagePreserveForced
    });
  }
}
