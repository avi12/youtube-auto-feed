import type { InnerTubeRichGridItem } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import { isPolymerElement } from "../utils/polymer";
import { deepArray, isRecord } from "../utils/records";
import { videoIdFromRichItem } from "./rich-item";

// "Bands" are positional groupings of feed items: contiguous root-level videos form one band,
// each rich shelf forms another, and title-only legacy shelves push subsequent root videos into
// a new section. captureBandLayout() snapshots the current band structure so insertions can be
// routed to the right zone later.

export type BandKind = "inline" | "richShelf";

export interface CapturedBand {
  sectionTitle: string;
  kind: BandKind;
}

export interface BandLayout {
  bands: CapturedBand[];
  sectionOrder: string[];
}

function readRichShelfTitle(item: Prettify<InnerTubeRichGridItem>) {
  return item?.richSectionRenderer?.content?.richShelfRenderer?.title?.runs?.[0]?.text ?? "";
}

function readTitleOnlyShelfTitle(item: Prettify<InnerTubeRichGridItem>) {
  if (item?.richSectionRenderer?.content?.richShelfRenderer) {
    return "";
  }

  return item?.richSectionRenderer?.content?.shelfRenderer?.title?.runs?.[0]?.text ?? "";
}

export function captureBandLayout() {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  const isGridUsable = !!elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data);
  if (!isGridUsable) {
    return null;
  }

  const contents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents");
  const bands: Prettify<CapturedBand>[] = [];
  const sectionOrder: string[] = [];
  let currentInlineSection = "";
  let currentInlineBand: Prettify<CapturedBand> | null = null;

  for (const item of contents) {
    const inlineVideoId = videoIdFromRichItem(item);
    if (inlineVideoId) {
      if (!currentInlineBand) {
        currentInlineBand = {
          sectionTitle: currentInlineSection,
          kind: "inline"
        };
        bands.push(currentInlineBand);
      }

      continue;
    }

    currentInlineBand = null;

    const richShelfTitle = readRichShelfTitle(item);
    if (richShelfTitle) {
      bands.push({
        sectionTitle: richShelfTitle,
        kind: "richShelf"
      });
      sectionOrder.push(richShelfTitle);
      continue;
    }

    const titleOnlyTitle = readTitleOnlyShelfTitle(item);
    if (titleOnlyTitle) {
      currentInlineSection = titleOnlyTitle;
      sectionOrder.push(titleOnlyTitle);
    }
  }

  return {
    bands,
    sectionOrder
  };
}

// Collapsed shelves (isExpanded: false) sometimes render more than one visible row depending on
// the browser's grid column count. This trims the overflow visible items from the data model so
// YouTube always shows exactly one row. Only overflow items are removed - hidden data items (not
// rendered in DOM) are preserved.
export async function normalizeCollapsedShelfRows() {
  const trimmedVideoIds = new Set<string>();
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    const isCollapsedShelf = isPolymerElement(elShelf) && isRecord(elShelf.data) && elShelf.data.isExpanded === false;
    if (!isCollapsedShelf) {
      continue;
    }

    // Two frames let Polymer finish rendering the shelf before we measure layout.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const elItems = [...elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")];
    // offsetWidth === 0 means YouTube has hidden the item (not part of the visible row set).
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
        if (!isPolymerElement(elItem) || !isRecord(elItem.data)) {
          return [];
        }

        const videoId = videoIdFromRichItem(elItem.data);
        return videoId ? [videoId] : [];
      })
    );

    // Filter data by video ID (not index) so hidden items beyond the visible set are untouched.
    const currentContents = deepArray<InnerTubeRichGridItem>(elShelf.data, "contents");
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
