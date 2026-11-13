import { videoIdFromRichItem } from "@/subscription-feed/dom/rich-item";
import type { PolymerElement } from "@/subscription-feed/types/polymer";
import type { Prettify } from "@/subscription-feed/types/prettify";
import { isRichGridData } from "@/subscription-feed/youtube-api/guards";

export function collectGridModelIds(elGrid: PolymerElement) {
  if (!isRichGridData(elGrid.data)) {
    return {
      standaloneModelIds: new Set<string>(),
      standaloneModelDuplicates: new Set<string>()
    };
  }

  const standaloneModelIds = new Set<string>();
  const standaloneModelDuplicates = new Set<string>();

  for (const item of elGrid.data.contents ?? []) {
    const videoId = videoIdFromRichItem(item);
    if (!videoId) {
      continue;
    }

    if (standaloneModelIds.has(videoId)) {
      standaloneModelDuplicates.add(videoId);
    } else {
      standaloneModelIds.add(videoId);
    }
  }

  return {
    standaloneModelIds,
    standaloneModelDuplicates
  };
}

type FilterMisplacedAndDuplicatesParams = Prettify<{
  elGrid: PolymerElement;
  misplacedIds: Set<string>;
  standaloneModelDuplicates: Set<string>;
}>;

export function filterMisplacedAndDuplicates({
  elGrid,
  misplacedIds,
  standaloneModelDuplicates
}: FilterMisplacedAndDuplicatesParams) {
  if (!isRichGridData(elGrid.data)) {
    return;
  }

  const seenDuplicates = new Set<string>();
  const filteredContents = (elGrid.data.contents ?? []).filter(item => {
    const videoId = videoIdFromRichItem(item);
    if (!videoId) {
      return true;
    }

    if (misplacedIds.has(videoId)) {
      return false;
    }

    if (standaloneModelDuplicates.has(videoId)) {
      if (seenDuplicates.has(videoId)) {
        return false;
      }

      seenDuplicates.add(videoId);
    }

    return true;
  });
  elGrid.set("data.contents", filteredContents);
}
