import type { InnerTubeRichGridItem } from "../types/innertube";
import type { PolymerElement } from "../types/polymer";
import type { Prettify } from "../types/prettify";
import { isPolymerElement } from "../utils/polymer";
import { deepArray } from "../utils/records";
import { gridDataSchema } from "../youtube-api/schemas";
import { pruneOrphanedDomItems } from "./orphan-cleanup-dom";
import { collectGridModelIds, filterMisplacedAndDuplicates } from "./orphan-cleanup-grid";

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

  const sectionTitleCounts = new Map<string, number>();
  for (const item of deepArray<InnerTubeRichGridItem>(elGrid.data, "contents")) {
    const sectionTitle = sectionTitleFromGridItem(item);
    if (sectionTitle) {
      sectionTitleCounts.set(sectionTitle, (sectionTitleCounts.get(sectionTitle) ?? 0) + 1);
    }
  }

  for (const elSection of elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-section-renderer")) {
    const sectionTitle = elSection.querySelector("#title")?.textContent?.trim() ?? "";
    const remainingInModel = sectionTitleCounts.get(sectionTitle) ?? 0;
    if (remainingInModel > 0) {
      sectionTitleCounts.set(sectionTitle, remainingInModel - 1);
      continue;
    }

    elSection.remove();
  }
}

function sectionTitleFromGridItem(item: Prettify<InnerTubeRichGridItem>) {
  const sectionContent = item?.richSectionRenderer?.content;
  const richShelfTitle = sectionContent?.richShelfRenderer?.title?.runs?.[0]?.text ?? "";
  const legacyShelfTitle = sectionContent?.shelfRenderer?.title?.runs?.[0]?.text ?? "";
  return richShelfTitle || legacyShelfTitle;
}
