import type {
  InnerTubeBrowseResponse,
  InnerTubeVideoRenderer,
  LockupViewModel,
  ShortsLockupViewModel,
  VideoSnapshot
} from "../types";
import { parseLockupViewModel, parseRenderer, parseShortsLockupViewModel } from "./parse-video";

interface CollectSnapshotParams {
  sectionTitle: string;
  bandIndex: number;
  snapshots: VideoSnapshot[];
  seenVideoIds: Set<string>;
  renderer?: InnerTubeVideoRenderer;
  lockup?: LockupViewModel;
  shortsLockup?: ShortsLockupViewModel;
}

function parseAnyRenderer({ sectionTitle, bandIndex, renderer, lockup, shortsLockup }: {
  sectionTitle: string;
  bandIndex: number;
  renderer?: InnerTubeVideoRenderer;
  lockup?: LockupViewModel;
  shortsLockup?: ShortsLockupViewModel;
}) {
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
}: CollectSnapshotParams) {
  const snapshot = parseAnyRenderer({
    sectionTitle,
    bandIndex,
    renderer,
    lockup,
    shortsLockup
  });
  if (!snapshot || seenVideoIds.has(snapshot.videoId)) {
    return;
  }

  seenVideoIds.add(snapshot.videoId);
  snapshots.push(snapshot);
}

export function extractApiSectionOrder(data: InnerTubeBrowseResponse) {
  const order: string[] = [];
  const seen = new Set<string>();
  try {
    const tabContent = data.contents.twoColumnBrowseResultsRenderer.tabs[0]?.tabRenderer.content;
    for (const item of tabContent?.richGridRenderer?.contents ?? []) {
      const title = item.richSectionRenderer?.content?.richShelfRenderer?.title?.runs?.[0]?.text
                ?? item.richSectionRenderer?.content?.shelfRenderer?.title?.runs?.[0]?.text;
      if (title && !seen.has(title)) {
        seen.add(title);
        order.push(title);
      }
    }
  } catch {}
  return order;
}

export function parseApiResponse(data: InnerTubeBrowseResponse) {
  const snapshots: VideoSnapshot[] = [];
  const seenVideoIds = new Set<string>();
  try {
    const tabContent = data.contents.twoColumnBrowseResultsRenderer.tabs[0]?.tabRenderer.content;

    function pushSnapshot(
      sectionTitle: string,
      bandIndex: number,
      renderer?: InnerTubeVideoRenderer,
      lockup?: LockupViewModel,
      shortsLockup?: ShortsLockupViewModel
    ) {
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
          currentSectionTitle = richShelfRenderer.title.runs[0]?.text ?? "";
          for (const richItem of richShelfRenderer.contents) {
            const content = richItem.richItemRenderer?.content;
            const renderer = content?.videoRenderer
              ?? content?.gridVideoRenderer
              ?? content?.richGridMediaRenderer?.content?.videoRenderer;
            pushSnapshot(
              currentSectionTitle,
              currentBandIndex,
              renderer,
              content?.lockupViewModel,
              content?.shortsLockupViewModel
            );
          }
          currentBandIndex++;
        } else if (shelfRenderer) {
          currentSectionTitle = shelfRenderer.title.runs[0]?.text ?? "";
          const shelfItems = shelfRenderer.content?.horizontalListRenderer?.items
            ?? shelfRenderer.content?.gridRenderer?.items
            ?? [];
          for (const shelfItem of shelfItems) {
            pushSnapshot(
              currentSectionTitle,
              currentBandIndex,
              shelfItem.videoRenderer ?? shelfItem.gridVideoRenderer
            );
          }

          if (shelfItems.length > 0) {
            currentBandIndex++;
          }
        }

        currentSectionTitle = "";
      } else if (item.richItemRenderer) {
        const { content } = item.richItemRenderer;
        const renderer = content?.videoRenderer
          ?? content?.gridVideoRenderer
          ?? content?.richGridMediaRenderer?.content?.videoRenderer;
        pushSnapshot(
          currentSectionTitle,
          currentBandIndex,
          renderer,
          content?.lockupViewModel,
          content?.shortsLockupViewModel
        );
      }
    }

    if (snapshots.length === 0) {
      for (const sectionItem of tabContent?.sectionListRenderer?.contents ?? []) {
        for (const innerItem of sectionItem.itemSectionRenderer?.contents ?? []) {
          const shelf = innerItem.shelfRenderer;
          if (!shelf) {
            continue;
          }

          const sectionTitle = shelf.title.runs[0]?.text ?? "";
          const shelfItems = shelf.content?.horizontalListRenderer?.items
            ?? shelf.content?.gridRenderer?.items
            ?? [];
          for (const shelfItem of shelfItems) {
            pushSnapshot(sectionTitle, 0, shelfItem.videoRenderer ?? shelfItem.gridVideoRenderer);
          }
        }
      }
    }
  } catch {}
  return snapshots;
}
