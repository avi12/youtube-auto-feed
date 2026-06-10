import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";
import { isPolymerElement } from "../../utils/polymer";
import { deepArray } from "../../utils/records";
import { gridDataSchema } from "../../youtube-api/schemas";
import { videoIdFromRichItem } from "../rich-item";

enum BandKind {
  Inline = "inline",
  RichShelf = "richShelf"
}

interface CapturedBand {
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
  const isGridUsable = !!elGrid && isPolymerElement(elGrid) && gridDataSchema.safeParse(elGrid.data).success;
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
