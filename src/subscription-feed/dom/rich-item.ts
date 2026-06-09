import type { InnerTubeRichGridItem, InnerTubeRichItemContent } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import { videoIdFromData } from "../utils/video-id";
import { isLockupViewModel, isShortsLockupViewModel, isVideoRenderer } from "../youtube-api/guards";

export function videoIdFromRichItem(
  contentItem: Prettify<InnerTubeRichGridItem> | Record<string, unknown> | undefined
) {
  return videoIdFromData(contentItem?.richItemRenderer);
}

export function isCollaborativeRichItem(item: Prettify<InnerTubeRichGridItem>) {
  const lockupViewModel = item.richItemRenderer?.content?.lockupViewModel;
  if (!isLockupViewModel(lockupViewModel)) {
    return false;
  }

  const stackedChannelAvatars =
    lockupViewModel.metadata?.lockupMetadataViewModel?.image?.avatarStackViewModel?.avatars;
  const hasMultipleChannels = (stackedChannelAvatars?.length ?? 0) > 1;
  return hasMultipleChannels;
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
