import type {
  InnerTubeBrowseResponse, InnerTubeRichItemContent, InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel, VideoSnapshot
} from "../types";
import { parseLockupViewModel, parseRenderer, parseShortsLockupViewModel } from "./parse-video";

function videoIdFromContent(content: InnerTubeRichItemContent) {
  return content.videoRenderer?.videoId
    ?? content.gridVideoRenderer?.videoId
    ?? content.richGridMediaRenderer?.content?.videoRenderer?.videoId
    ?? content.lockupViewModel?.contentId
    ?? content.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
    ?? "";
}

function collectSnapshot(
  sectionTitle: string,
  snapshots: VideoSnapshot[],
  seenVideoIds: Set<string>,
  renderer?: InnerTubeVideoRenderer,
  lockup?: LockupViewModel,
  shortsLockup?: ShortsLockupViewModel
) {
  let snapshot = null;
  if (renderer) {
    snapshot = parseRenderer(renderer, sectionTitle);
  } else if (lockup) {
    snapshot = parseLockupViewModel(lockup, sectionTitle);
  } else if (shortsLockup) {
    snapshot = parseShortsLockupViewModel(shortsLockup, sectionTitle);
  }

  if (snapshot && !seenVideoIds.has(snapshot.videoId)) {
    seenVideoIds.add(snapshot.videoId);
    snapshots.push(snapshot);
  }
}

export function parseApiResponse(data: InnerTubeBrowseResponse) {
  const snapshots: VideoSnapshot[] = [];
  const seenVideoIds = new Set<string>();
  try {
    const tabContent = data.contents.twoColumnBrowseResultsRenderer.tabs[0]?.tabRenderer.content;
    const pushSnapshot = (
      sectionTitle: string,
      renderer?: InnerTubeVideoRenderer,
      lockup?: LockupViewModel,
      shortsLockup?: ShortsLockupViewModel
    ) => collectSnapshot(sectionTitle, snapshots, seenVideoIds, renderer, lockup, shortsLockup);

    const sectionMembership = new Map<string, string>();
    for (const item of tabContent?.richGridRenderer?.contents ?? []) {
      if (!item.richSectionRenderer) continue;
      const { richShelfRenderer, shelfRenderer } = item.richSectionRenderer.content;
      if (richShelfRenderer) {
        const sectionTitle = richShelfRenderer.title.runs[0]?.text ?? "";
        for (const richItem of richShelfRenderer.contents) {
          const content = richItem.richItemRenderer?.content;
          if (!content) continue;
          const videoId = videoIdFromContent(content);
          if (videoId) sectionMembership.set(videoId, sectionTitle);
        }
      } else if (shelfRenderer) {
        const sectionTitle = shelfRenderer.title.runs[0]?.text ?? "";
        const shelfItems = shelfRenderer.content?.horizontalListRenderer?.items ?? shelfRenderer.content?.gridRenderer?.items ?? [];
        for (const shelfItem of shelfItems) {
          const videoId = shelfItem.videoRenderer?.videoId ?? shelfItem.gridVideoRenderer?.videoId ?? "";
          if (videoId) sectionMembership.set(videoId, sectionTitle);
        }
      }
    }

    let currentSectionTitle = "";
    for (const item of tabContent?.richGridRenderer?.contents ?? []) {
      if (item.richSectionRenderer) {
        const { richShelfRenderer, shelfRenderer } = item.richSectionRenderer.content;
        if (richShelfRenderer) {
          currentSectionTitle = richShelfRenderer.title.runs[0]?.text ?? "";
          for (const richItem of richShelfRenderer.contents) {
            const content = richItem.richItemRenderer?.content;
            pushSnapshot(
              currentSectionTitle,
              content?.videoRenderer ?? content?.gridVideoRenderer ?? content?.richGridMediaRenderer?.content?.videoRenderer,
              content?.lockupViewModel,
              content?.shortsLockupViewModel
            );
          }
        } else if (shelfRenderer) {
          currentSectionTitle = shelfRenderer.title.runs[0]?.text ?? "";
          const shelfItems = shelfRenderer.content?.horizontalListRenderer?.items ?? shelfRenderer.content?.gridRenderer?.items ?? [];
          for (const shelfItem of shelfItems) {
            pushSnapshot(currentSectionTitle, shelfItem.videoRenderer ?? shelfItem.gridVideoRenderer);
          }
        }

        currentSectionTitle = "";
      } else if (item.richItemRenderer) {
        const { content } = item.richItemRenderer;
        const videoId = videoIdFromContent(content);
        const effectiveSectionTitle = sectionMembership.get(videoId) ?? currentSectionTitle;
        pushSnapshot(
          effectiveSectionTitle,
          content?.videoRenderer ?? content?.gridVideoRenderer ?? content?.richGridMediaRenderer?.content?.videoRenderer,
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
          const shelfItems = shelf.content?.horizontalListRenderer?.items ?? shelf.content?.gridRenderer?.items ?? [];
          for (const shelfItem of shelfItems) {
            pushSnapshot(sectionTitle, shelfItem.videoRenderer ?? shelfItem.gridVideoRenderer);
          }
        }
      }
    }
  } catch {}
  return snapshots;
}
