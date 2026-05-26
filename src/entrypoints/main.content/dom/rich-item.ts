import { videoIdFromData } from "../helpers";
import type { InnerTubeRichGridItem, Prettify } from "../types";

export function videoIdFromRichItem(
  contentItem: Prettify<InnerTubeRichGridItem> | Record<string, unknown> | undefined
) {
  return videoIdFromData(contentItem?.richItemRenderer);
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
