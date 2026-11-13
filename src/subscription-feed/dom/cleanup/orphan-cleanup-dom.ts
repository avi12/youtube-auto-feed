import type { Prettify } from "@/subscription-feed/types/prettify";
import { isPolymerElement } from "@/subscription-feed/utils/polymer";
import { videoIdFromData } from "@/subscription-feed/utils/video-id";

type PruneOrphanedDomItemsParams = Prettify<{
  elGridContents: HTMLElement;
  standaloneModelIds: Set<string>;
}>;

export function pruneOrphanedDomItems({ elGridContents, standaloneModelIds }: PruneOrphanedDomItemsParams) {
  const seenDomIds = new Set<string>();
  for (const elChild of elGridContents.querySelectorAll<HTMLElement>(
    ":scope > ytd-rich-item-renderer, :scope > ytd-rich-section-renderer"
  )) {
    if (elChild.tagName !== "YTD-RICH-ITEM-RENDERER" || !isPolymerElement(elChild)) {
      continue;
    }

    const videoId = videoIdFromData(elChild.data);
    const isInModel = !!videoId && standaloneModelIds.has(videoId);
    const isDuplicate = !!videoId && seenDomIds.has(videoId);
    const isOrphaned = !isInModel || isDuplicate;
    if (isOrphaned) {
      elChild.remove();
    } else if (videoId) {
      seenDomIds.add(videoId);
    }
  }
}
