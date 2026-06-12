import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { isRichGridData } from "../../youtube-api/guards";
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
  const elGrid = document.querySelector<PolymerElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isRichGridData(elGrid.data)) {
    return null;
  }

  const contents = elGrid.data.contents ?? [];
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
