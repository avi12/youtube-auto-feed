import type { InnerTubeRichGridItem, InnerTubeRichItemContent } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import { VideoStatus } from "../types/video";
import { videoIdFromData } from "../utils/video-id";
import { isLockupViewModel, isShortsLockupViewModel, isVideoRenderer } from "../youtube-api/guards";

export function videoIdFromRichItem(
  contentItem: Prettify<InnerTubeRichGridItem> | Record<string, unknown> | undefined
) {
  return videoIdFromData(contentItem?.richItemRenderer);
}

const CHANNEL_BROWSE_ID = /"browseEndpoint":\{"browseId":"(UC[\w-]{22})"/g;

// A lockup links its uploader - and a collaborative (multi-channel) lockup links every collaborator -
// through channel browseEndpoints in its deeply nested, largely unmodelled view-model data. Returns all
// of them deduped, so the prune can keep a collaboration while any one collaborator is still subscribed.
// Empty for shorts lockups, which carry no channel reference - the caller resolves those via the watch page.
export function channelIdsFromRichItem(item: Prettify<InnerTubeRichGridItem>) {
  const { lockupViewModel } = item.richItemRenderer?.content ?? {};
  if (!isLockupViewModel(lockupViewModel)) {
    return [];
  }

  return [...new Set([...JSON.stringify(lockupViewModel).matchAll(CHANNEL_BROWSE_ID)].map(match => match[1]))];
}

export function isCollaborativeRichItem(item: Prettify<InnerTubeRichGridItem>) {
  const lockupViewModel = item.richItemRenderer?.content?.lockupViewModel;
  if (!isLockupViewModel(lockupViewModel)) {
    return false;
  }

  const stackedChannelAvatars =
    lockupViewModel.metadata?.lockupMetadataViewModel?.image?.avatarStackViewModel?.avatars;
  return (stackedChannelAvatars?.length ?? 0) > 1;
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

// A thumbnail's picture identity is its origin and path; the query is only a signed crop/size token
// (sqp/rs) that YouTube re-rotates every few minutes for an unchanged picture. A real edit changes the
// path instead (a new custom thumbnail bumps the hq720_custom_N filename). Comparing by this key keeps
// signature rotations from flashing a crossfade into the same picture; the byte-hash content watch is
// the backstop for a genuine same-path edit.
export function thumbnailPictureKey(url: string) {
  return url.split("?")[0];
}

// Live and upcoming thumbnails are volatile - a live stream re-captures its preview frame and a
// countdown card gets redrawn, both under the same /vi/ path with only a fresh sqp. Those are tracked
// by full URL so every refresh repaints; a settled video stays on the path key so the periodic sqp
// re-sign of one unchanged picture does not churn a crossfade.
type IsThumbnailChangedParams = Prettify<{
  previousUrl: string;
  freshUrl: string;
  freshStatus: VideoStatus;
}>;

export function isThumbnailChanged({ previousUrl, freshUrl, freshStatus }: IsThumbnailChangedParams) {
  const isVolatile = freshStatus === VideoStatus.Live || freshStatus === VideoStatus.Upcoming;
  if (isVolatile) {
    return previousUrl !== freshUrl;
  }

  return thumbnailPictureKey(previousUrl) !== thumbnailPictureKey(freshUrl);
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
