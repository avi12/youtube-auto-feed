import { deepRecord, videoIdFromData } from "../helpers";

export function videoIdFromRichItem(contentItem: unknown) {
  return videoIdFromData(deepRecord(contentItem, "richItemRenderer"));
}

export function findRichItemIndex(contents: unknown[], videoId: string) {
  return contents.findIndex(item => videoIdFromRichItem(item) === videoId);
}

export function filterOutRichItems(contents: unknown[], excludeVideoIds: Set<string>) {
  return contents.filter(item => {
    const id = videoIdFromRichItem(item);
    return !id || !excludeVideoIds.has(id);
  });
}

export function sortByFreshOrder<T extends { videoId: string; }>(videos: T[], freshOrder: Map<string, number>) {
  return videos.toSorted(
    (videoA, videoB) => (freshOrder.get(videoA.videoId) ?? 0) - (freshOrder.get(videoB.videoId) ?? 0)
  );
}
