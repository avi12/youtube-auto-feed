import { z } from "../../shared/zod";
import type { InnerTubeRichGridItem } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import { isPolymerElement } from "../utils/polymer";
import { deepArray } from "../utils/records";
import { videoIdFromRichItem } from "./rich-item";

const polymerDataSchema = z.looseObject({});

const shelfDataSchema = z.looseObject({
  isExpanded: z.boolean().optional()
});

// Bands are positional groupings: contiguous root-level videos = one inline band, each rich shelf
// = its own band, title-only legacy shelves start a new inline section. captureBandLayout()
// snapshots this structure so insertions can be routed to the correct zone.

export enum BandKind {
  Inline = "inline",
  RichShelf = "richShelf"
}

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
  const isGridUsable = !!elGrid && isPolymerElement(elGrid) && polymerDataSchema.safeParse(elGrid.data).success;
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
          kind: BandKind.Inline
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
        kind: BandKind.RichShelf
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

// Collapsed shelves (isExpanded: false) can overflow to multiple visible rows depending on column
// count. Trims the excess from the data model to enforce one row. Hidden (non-rendered) items are
// left untouched.
export async function normalizeCollapsedShelfRows() {
  const trimmedVideoIds = new Set<string>();
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    const shelfDataParsed = shelfDataSchema.safeParse(elShelf.data);
    const isCollapsedShelf = shelfDataParsed.success && shelfDataParsed.data.isExpanded === false;
    if (!isCollapsedShelf) {
      continue;
    }

    // Two rAF ticks let Polymer finish rendering before we measure layout.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const elItems = [...elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")];
    // offsetWidth === 0: YouTube has hidden the item (not in the visible row set).
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
        if (!isPolymerElement(elItem)) {
          return [];
        }

        const itemDataParsed = polymerDataSchema.safeParse(elItem.data);
        if (!itemDataParsed.success) {
          return [];
        }

        const videoId = videoIdFromRichItem(itemDataParsed.data);
        return videoId ? [videoId] : [];
      })
    );

    // Filter by video ID (not index) so hidden items beyond the visible set are untouched.
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
