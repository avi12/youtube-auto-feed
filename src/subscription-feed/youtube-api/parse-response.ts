import type { InnerTubeBrowseResponse, InnerTubeRichGridItem } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";
import { parseLockupViewModel, parseRenderer, parseShortsLockupViewModel } from "./parse-video";

// Walks an InnerTube /browse response and produces VideoSnapshots tagged with section/band.
// Single entry point for turning an API payload into something the diff layer can compare.

interface AnyRendererParams {
  sectionTitle: string;
  bandIndex: number;
  renderer?: import("../types/innertube").InnerTubeVideoRenderer;
  lockup?: import("../types/innertube").LockupViewModel;
  shortsLockup?: import("../types/innertube").ShortsLockupViewModel;
}

interface CollectSnapshotParams extends AnyRendererParams {
  snapshots: VideoSnapshot[];
  seenVideoIds: Set<string>;
}

interface RichSectionParams {
  richSectionContent: NonNullable<InnerTubeRichGridItem["richSectionRenderer"]>["content"];
  bandIndex: number;
  pushSnapshot: (params: Prettify<AnyRendererParams>) => void;
}

function parseAnyRenderer({ sectionTitle, bandIndex, renderer, lockup, shortsLockup }: Prettify<AnyRendererParams>) {
  if (renderer) {
    return parseRenderer({
      renderer,
      sectionTitle,
      bandIndex
    });
  }

  if (lockup) {
    return parseLockupViewModel({
      lockup,
      sectionTitle,
      bandIndex
    });
  }

  if (shortsLockup) {
    return parseShortsLockupViewModel({
      shortsLockup,
      sectionTitle,
      bandIndex
    });
  }

  return null;
}

function collectSnapshot({
  sectionTitle,
  bandIndex,
  snapshots,
  seenVideoIds,
  renderer,
  lockup,
  shortsLockup
}: Prettify<CollectSnapshotParams>) {
  const snapshot = parseAnyRenderer({
    sectionTitle,
    bandIndex,
    renderer,
    lockup,
    shortsLockup
  });
  const isFreshSnapshot = !!snapshot && !seenVideoIds.has(snapshot.videoId);
  if (!isFreshSnapshot) {
    return;
  }

  seenVideoIds.add(snapshot.videoId);
  snapshots.push(snapshot);
}

// Returns raw richGridRenderer.contents. The mirror walks this directly to preserve
// richSectionRenderer items - flat VideoSnapshots lose shelf wrapping.
export function extractApiContents(data: Prettify<InnerTubeBrowseResponse>): Prettify<InnerTubeRichGridItem>[] {
  return data.contents.twoColumnBrowseResultsRenderer.tabs[0]?.tabRenderer.content?.richGridRenderer?.contents ?? [];
}

// Returns section titles in emission order. YouTube sometimes repeats a shelf header; duplicates collapse to first.
export function extractApiSectionOrder(data: Prettify<InnerTubeBrowseResponse>) {
  const order: string[] = [];
  const seen = new Set<string>();
  try {
    const tabContent = data.contents.twoColumnBrowseResultsRenderer.tabs[0]?.tabRenderer.content;
    for (const item of tabContent?.richGridRenderer?.contents ?? []) {
      const { richShelfRenderer, shelfRenderer } = item.richSectionRenderer?.content ?? {};
      const title = richShelfRenderer?.title?.runs?.[0]?.text
                ?? shelfRenderer?.title?.runs?.[0]?.text;
      if (!title) {
        continue;
      }

      if (seen.has(title)) {
        continue;
      }

      seen.add(title);
      order.push(title);
    }
  } catch {}
  return order;
}

function collectRichSectionSnapshots({ richSectionContent, bandIndex, pushSnapshot }: Prettify<RichSectionParams>) {
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
    for (const item of tabContent?.richGridRenderer?.contents ?? []) {
      if (item.richSectionRenderer) {
        ({ sectionTitle: currentSectionTitle, bandIndex: currentBandIndex } = collectRichSectionSnapshots({
          richSectionContent: item.richSectionRenderer.content,
          bandIndex: currentBandIndex,
          pushSnapshot
        }));
      } else if (item.richItemRenderer) {
        const {
          videoRenderer,
          gridVideoRenderer,
          richGridMediaRenderer,
          lockupViewModel,
          shortsLockupViewModel
        } = item.richItemRenderer.content;
        pushSnapshot({
          sectionTitle: currentSectionTitle,
          bandIndex: currentBandIndex,
          renderer: videoRenderer ?? gridVideoRenderer ?? richGridMediaRenderer?.content?.videoRenderer,
          lockup: lockupViewModel,
          shortsLockup: shortsLockupViewModel
        });
      }
    }

    // Fallback for older feeds that use sectionListRenderer instead of richGridRenderer.
    if (snapshots.length === 0) {
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
  } catch {}
  return snapshots;
}
