import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { deepArray } from "../../utils/records";
import { gridDataSchema } from "../../youtube-api/schemas";
import { videoIdFromRichItem } from "../rich-item";

export function collectGridModelIds(elGrid: PolymerElement) {
  if (!gridDataSchema.safeParse(elGrid.data).success) {
    return {
      standaloneModelIds: new Set<string>(),
      standaloneModelDuplicates: new Set<string>()
    };
  }

  const standaloneModelIds = new Set<string>();
  const standaloneModelDuplicates = new Set<string>();

  for (const item of deepArray<InnerTubeRichGridItem>(elGrid.data, "contents")) {
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
  if (!gridDataSchema.safeParse(elGrid.data).success) {
    return;
  }

  const seenDuplicates = new Set<string>();
  const filteredContents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents").filter(item => {
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
