import type {
  InnerTubeBrowseResponse,
  InnerTubeVideoRenderer,
  LockupViewModel,
  Prettify,
  ShortsLockupViewModel,
  VideoSnapshot
} from "../types";
import { parseLockupViewModel, parseRenderer, parseShortsLockupViewModel } from "./parse-video";

interface AnyRendererParams {
  sectionTitle: string;
  bandIndex: number;
  renderer?: InnerTubeVideoRenderer;
  lockup?: LockupViewModel;
  shortsLockup?: ShortsLockupViewModel;
}

interface CollectSnapshotParams extends AnyRendererParams {
  snapshots: VideoSnapshot[];
  seenVideoIds: Set<string>;
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
  const isDuplicateOrEmpty = !snapshot || seenVideoIds.has(snapshot.videoId);
  if (isDuplicateOrEmpty) {
    return;
  }

  seenVideoIds.add(snapshot.videoId);
  snapshots.push(snapshot);
}

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
        const { richShelfRenderer, shelfRenderer } = item.richSectionRenderer.content;
        if (richShelfRenderer) {
          const { title, contents } = richShelfRenderer;
          currentSectionTitle = title.runs[0]?.text ?? "";
          for (const richItem of contents) {
            const {
              videoRenderer,
              gridVideoRenderer,
              richGridMediaRenderer,
              lockupViewModel,
              shortsLockupViewModel
            } = richItem.richItemRenderer?.content ?? {};
            pushSnapshot({
              sectionTitle: currentSectionTitle,
              bandIndex: currentBandIndex,
              renderer: videoRenderer ?? gridVideoRenderer ?? richGridMediaRenderer?.content?.videoRenderer,
              lockup: lockupViewModel,
              shortsLockup: shortsLockupViewModel
            });
          }
          currentBandIndex++;
        } else if (shelfRenderer) {
          const { title, content } = shelfRenderer;
          currentSectionTitle = title.runs[0]?.text ?? "";
          const shelfItems = content?.horizontalListRenderer?.items
            ?? content?.gridRenderer?.items
            ?? [];
          for (const shelfItem of shelfItems) {
            pushSnapshot({
              sectionTitle: currentSectionTitle,
              bandIndex: currentBandIndex,
              renderer: shelfItem.videoRenderer ?? shelfItem.gridVideoRenderer
            });
          }

          if (shelfItems.length > 0) {
            currentBandIndex++;
          }
        }

        // Root-level video items following a shelf are Latest-band siblings, not part of the shelf.
        currentSectionTitle = "";
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

    // Legacy sectionListRenderer fallback for older feed shapes.
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
