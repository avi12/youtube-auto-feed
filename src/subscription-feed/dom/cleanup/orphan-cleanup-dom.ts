import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { videoIdFromData } from "../../utils/video-id";

type PruneOrphanedDomItemsParams = Prettify<{
  elGridContents: HTMLElement;
  standaloneModelIds: Set<string>;
}>;

export function pruneOrphanedDomItems({ elGridContents, standaloneModelIds }: PruneOrphanedDomItemsParams) {
  const seenDomIds = new Set<string>();
  for (const elChild of elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer, :scope > ytd-rich-section-renderer")) {
    if (elChild.tagName !== "YTD-RICH-ITEM-RENDERER" || !isPolymerElement(elChild)) {
      continue;
    }

    const videoId = videoIdFromData(elChild.data);
    const isInModel = !!videoId && standaloneModelIds.has(videoId);
    const isDuplicate = !!videoId && seenDomIds.has(videoId);
    if (!isInModel || isDuplicate) {
      elChild.remove();
    } else if (videoId) {
      seenDomIds.add(videoId);
    }
  }
}
