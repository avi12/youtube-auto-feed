import type { InnerTubeRichGridItem } from "../types/innertube";
import type { PolymerElement } from "../types/polymer";
import type { Prettify } from "../types/prettify";
import { isPolymerElement } from "../utils/polymer";
import { deepArray } from "../utils/records";
import { videoIdFromData } from "../utils/video-id";
import { gridDataSchema } from "../youtube-api/schemas";
import { videoIdFromRichItem } from "./rich-item";

// Reconciles Polymer drift: prunes DOM items whose videoId is no longer in `data.contents`,
// dedupes the data model, and removes section headers that no longer exist in the data.

export function cleanOrphanedGridItems() {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  const isGridUsable = !!elGrid && isPolymerElement(elGrid) && gridDataSchema.safeParse(elGrid.data).success;
  if (!isGridUsable) {
    return;
  }

  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  if (!elGridContents) {
    return;
  }

  const { standaloneModelIds, standaloneModelDuplicates } = collectGridModelIds(elGrid);
  if (standaloneModelDuplicates.size > 0) {
    filterMisplacedAndDuplicates({
      elGrid,
      misplacedIds: new Set(),
      standaloneModelDuplicates
    });
  }

  pruneOrphanedDomItems({
    elGridContents,
    standaloneModelIds
  });
  pruneOrphanedDomSections({
    elGrid,
    elGridContents
  });
}

type PruneOrphanedDomSectionsParams = Prettify<{
  elGrid: PolymerElement;
  elGridContents: HTMLElement;
}>;

function pruneOrphanedDomSections({ elGrid, elGridContents }: PruneOrphanedDomSectionsParams) {
  if (!gridDataSchema.safeParse(elGrid.data).success) {
    return;
  }

  const titleCounts = new Map<string, number>();
  for (const item of deepArray<InnerTubeRichGridItem>(elGrid.data, "contents")) {
    const richShelfTitle = item?.richSectionRenderer?.content?.richShelfRenderer?.title?.runs?.[0]?.text ?? "";
    const innerShelfTitle = item?.richSectionRenderer?.content?.shelfRenderer?.title?.runs?.[0]?.text ?? "";
    const title = richShelfTitle || innerShelfTitle;
    if (title) {
      titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    }
  }

  for (const elSection of elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-section-renderer")) {
    const title = elSection.querySelector("#title")?.textContent?.trim() ?? "";
    const remaining = titleCounts.get(title) ?? 0;
    if (remaining > 0) {
      titleCounts.set(title, remaining - 1);
      continue;
    }

    elSection.remove();
  }
}

function collectGridModelIds(elGrid: PolymerElement) {
  if (!gridDataSchema.safeParse(elGrid.data).success) {
    return {
      standaloneModelIds: new Set<string>(),
      standaloneModelDuplicates: new Set<string>(),
      sectionIds: new Set<string>()
    };
  }

  const standaloneModelIds = new Set<string>();
  const standaloneModelDuplicates = new Set<string>();

  for (const item of deepArray<InnerTubeRichGridItem>(elGrid.data, "contents")) {
    const topId = videoIdFromRichItem(item);
    if (!topId) {
      continue;
    }

    if (standaloneModelIds.has(topId)) {
      standaloneModelDuplicates.add(topId);
    } else {
      standaloneModelIds.add(topId);
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

function filterMisplacedAndDuplicates({
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

type PruneOrphanedDomItemsParams = Prettify<{
  elGridContents: HTMLElement;
  standaloneModelIds: Set<string>;
}>;

function pruneOrphanedDomItems({ elGridContents, standaloneModelIds }: PruneOrphanedDomItemsParams) {
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
