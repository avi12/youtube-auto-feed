import type { InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel, VideoSnapshot } from "../types";
import { VideoStatus } from "../types";
import { statusFromLockup, statusFromRenderer, viewCountFromRenderer } from "./guards";

export function parseRenderer(renderer: InnerTubeVideoRenderer, sectionTitle: string): VideoSnapshot | null {
  const {
    videoId, title, thumbnail, publishedTimeText
  } = renderer;
  if (videoId === "") {
    return null;
  }

  return {
    videoId,
    title: title.runs?.[0]?.text ?? title.simpleText ?? "",
    thumbnailUrl: thumbnail.thumbnails.at(-1)?.url.split("?")[0] ?? "",
    status: statusFromRenderer(renderer),
    viewCountText: viewCountFromRenderer(renderer),
    publishedTimeText: publishedTimeText?.simpleText ?? "",
    isChannelLive: false,
    sectionTitle,
    rawRenderer: renderer
  } satisfies VideoSnapshot;
}

export function parseLockupViewModel(lockup: LockupViewModel, sectionTitle: string): VideoSnapshot | null {
  const { contentId, contentImage, metadata } = lockup;
  if (contentId === "") {
    return null;
  }

  const metaViewModel = metadata?.lockupMetadataViewModel;
  const title = metaViewModel?.title?.content ?? "";
  const sources = contentImage?.thumbnailViewModel?.image?.sources;
  const thumbnailUrl = sources?.at(-1)?.url.split("?")[0] ?? "";
  const metaRows = metaViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
  const metaParts = metaRows?.[1]?.metadataParts;
  const viewCountText = metaParts?.[0]?.text?.content ?? "";
  const publishedTimeText = metaParts?.[1]?.text?.content ?? "";
  const status = statusFromLockup(lockup);
  const isChannelLive = !!metaViewModel?.image?.decoratedAvatarViewModel?.liveData?.liveBadgeText;
  return {
    videoId: contentId,
    title,
    thumbnailUrl,
    status,
    viewCountText,
    publishedTimeText,
    isChannelLive,
    sectionTitle,
    rawRenderer: lockup
  } satisfies VideoSnapshot;
}

export function parseShortsLockupViewModel(shortsLockup: ShortsLockupViewModel, sectionTitle: string): VideoSnapshot | null {
  const videoId = shortsLockup.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? "";
  if (videoId === "") {
    return null;
  }

  const title = shortsLockup.overlayMetadata?.primaryText?.content ?? shortsLockup.accessibilityText ?? "";
  const thumbnailUrl = shortsLockup.thumbnail?.sources?.at(-1)?.url.split("?")[0] ?? "";
  const viewCountText = shortsLockup.overlayMetadata?.secondaryText?.content ?? "";
  return {
    videoId,
    title,
    thumbnailUrl,
    status: VideoStatus.Short,
    viewCountText,
    publishedTimeText: "",
    isChannelLive: false,
    sectionTitle,
    rawRenderer: shortsLockup
  } satisfies VideoSnapshot;
}
