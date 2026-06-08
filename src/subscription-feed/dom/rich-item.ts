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

// A collaborative video is associated with more than one channel - YouTube renders its byline avatar
// as a stack of channel pictures (avatarStackViewModel) rather than a single decoratedAvatarViewModel.
export function isCollaborativeRichItem(item: Prettify<InnerTubeRichGridItem>) {
  const lockupViewModel = item.richItemRenderer?.content?.lockupViewModel;
  if (!isLockupViewModel(lockupViewModel)) {
    return false;
  }

  const avatars = lockupViewModel.metadata?.lockupMetadataViewModel?.image?.avatarStackViewModel?.avatars;
  return (avatars?.length ?? 0) > 1;
}

export function avatarUrlFromContent(content: Prettify<InnerTubeRichItemContent>) {
  const { lockupViewModel } = content;
  if (!isLockupViewModel(lockupViewModel)) {
    return "";
  }

  return lockupViewModel.metadata?.lockupMetadataViewModel?.image
    ?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources?.at(-1)?.url ?? "";
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

type FindRichItemIndexParams = Prettify<{
  contents: Prettify<InnerTubeRichGridItem>[];
  videoId: string;
}>;

export function findRichItemIndex({ contents, videoId }: FindRichItemIndexParams) {
  return contents.findIndex(item => videoIdFromRichItem(item) === videoId);
}

type FilterOutRichItemsParams = Prettify<{
  contents: Prettify<InnerTubeRichGridItem>[];
  excludeVideoIds: Set<string>;
}>;

export function filterOutRichItems({ contents, excludeVideoIds }: FilterOutRichItemsParams) {
  return contents.filter(item => {
    const videoId = videoIdFromRichItem(item);
    return !videoId || !excludeVideoIds.has(videoId);
  });
}

type SortByFreshOrderParams<T extends { videoId: string }> = Prettify<{
  videos: T[];
  freshOrder: Map<string, number>;
}>;

export function sortByFreshOrder<T extends { videoId: string }>({ videos, freshOrder }: SortByFreshOrderParams<T>) {
  return videos.toSorted(
    (videoA, videoB) => (freshOrder.get(videoA.videoId) ?? 0) - (freshOrder.get(videoB.videoId) ?? 0)
  );
}
