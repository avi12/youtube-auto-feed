import type { InnerTubeBrowseResponse, InnerTubeRichGridItem } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";
import { collectRichSectionSnapshots, collectSectionListSnapshots } from "./section-snapshots";
import { type AnyRendererParams, collectSnapshot } from "./snapshot-collect";

// The mirror walks raw contents to keep richSectionRenderer wrapping that flat snapshots would lose.
export function extractApiContents(data: Prettify<InnerTubeBrowseResponse>): Prettify<InnerTubeRichGridItem>[] {
  return data.contents.twoColumnBrowseResultsRenderer.tabs[0]?.tabRenderer.content?.richGridRenderer?.contents ?? [];
}

export function extractApiSectionOrder(data: Prettify<InnerTubeBrowseResponse>) {
  const sectionOrder: string[] = [];
  const seenTitles = new Set<string>();
  try {
    const tabContent = data.contents.twoColumnBrowseResultsRenderer.tabs[0]?.tabRenderer.content;
    for (const gridItem of tabContent?.richGridRenderer?.contents ?? []) {
      const { richShelfRenderer, shelfRenderer } = gridItem.richSectionRenderer?.content ?? {};
      const title = richShelfRenderer?.title?.runs?.[0]?.text
                ?? shelfRenderer?.title?.runs?.[0]?.text;
      if (!title) {
        continue;
      }

      if (seenTitles.has(title)) {
        continue;
      }

      seenTitles.add(title);
      sectionOrder.push(title);
    }
  } catch {}
  return sectionOrder;
}

export function parseApiResponse(data: Prettify<InnerTubeBrowseResponse>) {
  const snapshots: Prettify<VideoSnapshot>[] = [];
  const seenVideoIds = new Set<string>();
  try {
    const tabContent = data.contents.twoColumnBrowseResultsRenderer.tabs[0]?.tabRenderer.content;

    function pushSnapshot({ sectionTitle, bandIndex, renderer, lockup, shortsLockup }: Prettify<AnyRendererParams>) {
      collectSnapshot({
        sectionTitle,
        bandIndex,
        snapshots,
        seenVideoIds,
        renderer,
        lockup,
        shortsLockup
      });
    }

    let currentSectionTitle = "";
    let currentBandIndex = 0;
    for (const gridItem of tabContent?.richGridRenderer?.contents ?? []) {
      if (gridItem.richSectionRenderer) {
        ({ sectionTitle: currentSectionTitle, bandIndex: currentBandIndex } = collectRichSectionSnapshots({
          richSectionContent: gridItem.richSectionRenderer.content,
          bandIndex: currentBandIndex,
          pushSnapshot
        }));
      } else if (gridItem.richItemRenderer) {
        const {
          videoRenderer,
          gridVideoRenderer,
          richGridMediaRenderer,
          lockupViewModel,
          shortsLockupViewModel
        } = gridItem.richItemRenderer.content;
        pushSnapshot({
          sectionTitle: currentSectionTitle,
          bandIndex: currentBandIndex,
          renderer: videoRenderer ?? gridVideoRenderer ?? richGridMediaRenderer?.content?.videoRenderer,
          lockup: lockupViewModel,
          shortsLockup: shortsLockupViewModel
        });
      }
    }

    if (snapshots.length === 0) {
      collectSectionListSnapshots({
        tabContent,
        pushSnapshot
      });
    }
  } catch {}
  return snapshots;
}
