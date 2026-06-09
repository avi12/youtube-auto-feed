import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import { isPolymerElement } from "../../utils/polymer";
import { deepArray } from "../../utils/records";
import { gridDataSchema, richShelfDataSchema } from "../../youtube-api/schemas";
import { findRichItemIndex } from "../rich-item";
import { applyRichItemContentUpdate } from "./polymer-renderer-merge";
import type { ApplyToContainerParams } from "./polymer-sync-types";

export { applyToLegacyShelfModels } from "./polymer-sync-legacy";

type UpdateRichItemParams = ApplyToContainerParams & {
  elElement: PolymerElement;
};

function updateRichItem({ elElement, videoId, rawRenderer, forcePreserveContentImage }: UpdateRichItemParams) {
  const contents = deepArray<InnerTubeRichGridItem>(elElement.data, "contents");
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
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  const isGridUsable = !!elGrid && isPolymerElement(elGrid) && gridDataSchema.safeParse(elGrid.data).success;
  if (!isGridUsable) {
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
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    const isRichShelfUsable = isPolymerElement(elShelf) && richShelfDataSchema.safeParse(elShelf.data).success;
    if (!isRichShelfUsable) {
      continue;
    }

    updateRichItem({
      elElement: elShelf,
      videoId,
      rawRenderer,
      forcePreserveContentImage
    });
  }
}
