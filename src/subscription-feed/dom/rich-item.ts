import type { InnerTubeRichGridItem, InnerTubeRichItemContent } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import { videoIdFromData } from "../utils/video-id";
import { isLockupViewModel, isShortsLockupViewModel, isVideoRenderer } from "../youtube-api/guards";

// Helpers for InnerTube richItemRenderer envelopes - shared between the diff and DOM mutation
// layers, so they live here rather than colocated with either.

export function videoIdFromRichItem(
  contentItem: Prettify<InnerTubeRichGridItem> | Record<string, unknown> | undefined
) {
  return videoIdFromData(contentItem?.richItemRenderer);
}

// Collaborative videos (multi-channel) use avatarStackViewModel instead of decoratedAvatarViewModel.
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
