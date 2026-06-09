import type { InnerTubeBrowseResponse, InnerTubeRichGridItem } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import type { AnyRendererParams } from "./snapshot-collect";

type PushSnapshot = (params: Prettify<AnyRendererParams>) => void;

interface RichSectionParams {
  richSectionContent: NonNullable<InnerTubeRichGridItem["richSectionRenderer"]>["content"];
  bandIndex: number;
  pushSnapshot: PushSnapshot;
}

export function collectRichSectionSnapshots({
  richSectionContent,
  bandIndex,
  pushSnapshot
}: Prettify<RichSectionParams>) {
  const { richShelfRenderer, shelfRenderer } = richSectionContent;
  if (richShelfRenderer) {
    const { title, contents } = richShelfRenderer;
    const sectionTitle = title.runs[0]?.text ?? "";
    for (const richItem of contents) {
      const {
        videoRenderer,
        gridVideoRenderer,
        richGridMediaRenderer,
        lockupViewModel,
        shortsLockupViewModel
      } = richItem.richItemRenderer?.content ?? {};
      pushSnapshot({
        sectionTitle,
        bandIndex,
        renderer: videoRenderer ?? gridVideoRenderer ?? richGridMediaRenderer?.content?.videoRenderer,
        lockup: lockupViewModel,
        shortsLockup: shortsLockupViewModel
      });
    }
    return {
      sectionTitle: "",
      bandIndex: bandIndex + 1
    };
  }

  if (shelfRenderer) {
    const { title, content } = shelfRenderer;
    const sectionTitle = title.runs[0]?.text ?? "";
    const shelfItems = content?.horizontalListRenderer?.items
      ?? content?.gridRenderer?.items
      ?? [];
    for (const shelfItem of shelfItems) {
      pushSnapshot({
        sectionTitle,
        bandIndex,
        renderer: shelfItem.videoRenderer ?? shelfItem.gridVideoRenderer
      });
    }
    return {
      sectionTitle: "",
      bandIndex: shelfItems.length > 0 ? bandIndex + 1 : bandIndex
    };
  }

  return {
    sectionTitle: "",
    bandIndex
  };
}

type TabContent = NonNullable<
  InnerTubeBrowseResponse["contents"]["twoColumnBrowseResultsRenderer"]["tabs"][number]["tabRenderer"]["content"]
>;

// Fallback for older feeds that use sectionListRenderer instead of richGridRenderer.
export function collectSectionListSnapshots(tabContent: TabContent | undefined, pushSnapshot: PushSnapshot) {
  for (const sectionItem of tabContent?.sectionListRenderer?.contents ?? []) {
    for (const innerItem of sectionItem.itemSectionRenderer?.contents ?? []) {
      const shelf = innerItem.shelfRenderer;
      if (!shelf) {
        continue;
      }

      const { title, content } = shelf;
      const sectionTitle = title.runs[0]?.text ?? "";
      const shelfItems = content?.horizontalListRenderer?.items
        ?? content?.gridRenderer?.items
        ?? [];
      for (const shelfItem of shelfItems) {
        pushSnapshot({
          sectionTitle,
          bandIndex: 0,
          renderer: shelfItem.videoRenderer ?? shelfItem.gridVideoRenderer
        });
      }
    }
  }
}
