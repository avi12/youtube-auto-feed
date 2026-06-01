import type { InnerTubeRichGridItem, InnerTubeRichItemContent } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import { videoIdFromData } from "../utils/video-id";
import { isLockupViewModel, isShortsLockupViewModel, isVideoRenderer } from "../youtube-api/guards";

// Small helpers for working with InnerTube richItemRenderer envelopes (the wrapper YouTube uses
// for every grid/shelf item in the feed). They're shared between the diff layer and the DOM
// mutation layer, so they live here rather than colocated with either.

export function videoIdFromRichItem(
  contentItem: Prettify<InnerTubeRichGridItem> | Record<string, unknown> | undefined
) {
  return videoIdFromData(contentItem?.richItemRenderer);
}

export function thumbnailUrlFromContent(content: Prettify<InnerTubeRichItemContent>) {
  const { videoRenderer, lockupViewModel, shortsLockupViewModel } = content;
  if (isVideoRenderer(videoRenderer)) {
    return videoRenderer.thumbnail.thumbnails.at(-1)?.url ?? "";
  }

  if (isLockupViewModel(lockupViewModel)) {
    return lockupViewModel.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url ?? "";
  }

  if (isShortsLockupViewModel(shortsLockupViewModel)) {
    return shortsLockupViewModel.thumbnail?.sources?.at(-1)?.url ?? "";
  }

  return "";
}

export function thumbnailUrlFromRichItem(item: Prettify<InnerTubeRichGridItem>) {
  const content = item.richItemRenderer?.content;
  if (!content) {
    return "";
  }

  return thumbnailUrlFromContent(content);
}

export function findRichItemIndex({ contents, videoId }: {
  contents: Prettify<InnerTubeRichGridItem>[];
  videoId: string;
}) {
  return contents.findIndex(item => videoIdFromRichItem(item) === videoId);
}

export function filterOutRichItems({ contents, excludeVideoIds }: {
  contents: Prettify<InnerTubeRichGridItem>[];
  excludeVideoIds: Set<string>;
}) {
  return contents.filter(item => {
    const videoId = videoIdFromRichItem(item);
    return !videoId || !excludeVideoIds.has(videoId);
  });
}

export function sortByFreshOrder<T extends { videoId: string }>({ videos, freshOrder }: {
  videos: T[];
  freshOrder: Map<string, number>;
}) {
  return videos.toSorted(
    (videoA, videoB) => (freshOrder.get(videoA.videoId) ?? 0) - (freshOrder.get(videoB.videoId) ?? 0)
  );
}
