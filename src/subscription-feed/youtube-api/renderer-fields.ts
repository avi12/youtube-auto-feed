import {
  BadgeStyle,
  type ImageSource,
  type InnerTubeText,
  type InnerTubeVideoRenderer,
  LockupBadgeStyle,
  LockupContentType,
  type LockupViewModel,
  OverlayStyle,
  type ShortsLockupViewModel
} from "@/subscription-feed/types/innertube";
import type { Prettify } from "@/subscription-feed/types/prettify";
import { VideoStatus } from "@/subscription-feed/types/video";

const STREAMED_AGO_TEXT_PREFIX = "streamed";
const UPCOMING_BADGE_TEXT = "Upcoming";

// The full text of a formatted string: a plain simpleText, or the concatenated runs of a rich one.
export function textFromInnerTubeText(text: Prettify<InnerTubeText> | undefined) {
  return text?.simpleText ?? text?.runs?.map(run => run.text).join("") ?? "";
}

export function viewCountFromRenderer(renderer: Prettify<InnerTubeVideoRenderer>) {
  const { viewCountText, shortViewCountText } = renderer;
  const { simpleText, runs } = viewCountText ?? {};
  return simpleText ?? runs?.map(({ text }) => text).join("") ?? shortViewCountText?.simpleText ?? "";
}

export function statusFromRenderer(renderer: Prettify<InnerTubeVideoRenderer>) {
  const { badges, thumbnailOverlays, navigationEndpoint, upcomingEventData, publishedTimeText } = renderer;
  const badgeStyle = badges?.find(badge => badge.metadataBadgeRenderer)?.metadataBadgeRenderer?.style;
  const overlayStyle = thumbnailOverlays?.find(overlay => overlay.thumbnailOverlayTimeStatusRenderer)
    ?.thumbnailOverlayTimeStatusRenderer?.style;
  const isLive = badgeStyle === BadgeStyle.LiveNow || overlayStyle === OverlayStyle.Live;
  if (isLive) {
    return VideoStatus.Live;
  }

  // "Streamed X ago" lands before YouTube clears upcomingEventData, so this text overrides the stale upcoming signal.
  const isStreamedAgo = publishedTimeText?.simpleText?.toLowerCase().startsWith(STREAMED_AGO_TEXT_PREFIX) ?? false;
  const isUpcomingSignalPresent =
    badgeStyle === BadgeStyle.Upcoming || overlayStyle === OverlayStyle.Upcoming || upcomingEventData !== undefined;
  const isUpcoming = !isStreamedAgo && isUpcomingSignalPresent;
  if (isUpcoming) {
    return VideoStatus.Upcoming;
  }

  if (navigationEndpoint?.reelWatchEndpoint !== undefined) {
    return VideoStatus.Short;
  }

  return VideoStatus.Video;
}

function imageSourceArea({ width = 0, height = 0 }: Prettify<ImageSource>) {
  return width * height;
}

// The shorts shelf has served two shapes: the older `thumbnail.sources` and the newer nested
// `thumbnailViewModel.thumbnailViewModel.image.sources`. YouTube paints the largest source.
export function thumbnailUrlFromShortsLockup({ thumbnail, thumbnailViewModel }: Prettify<ShortsLockupViewModel>) {
  const sources = thumbnail?.sources ?? thumbnailViewModel?.thumbnailViewModel?.image?.sources ?? [];
  let largest: Prettify<ImageSource> | null = null;
  for (const source of sources) {
    const isBestLarger: boolean = largest !== null && imageSourceArea(largest) > imageSourceArea(source);
    largest = isBestLarger ? largest : source;
  }
  return largest?.url ?? "";
}

export function statusFromLockup(lockup: Prettify<LockupViewModel>) {
  const { contentType, contentImage } = lockup;
  if (contentType === LockupContentType.Shorts) {
    return VideoStatus.Short;
  }

  const { overlays = [] } = contentImage?.thumbnailViewModel ?? {};
  for (const overlay of overlays) {
    for (const badge of overlay.thumbnailBottomOverlayViewModel?.badges ?? []) {
      const { badgeStyle, text } = badge.thumbnailBadgeViewModel ?? {};
      if (badgeStyle === LockupBadgeStyle.Live) {
        return VideoStatus.Live;
      }

      if (badgeStyle === LockupBadgeStyle.Upcoming) {
        return VideoStatus.Upcoming;
      }

      const isUpcomingTextWithoutBadgeStyle = text === UPCOMING_BADGE_TEXT;
      if (isUpcomingTextWithoutBadgeStyle) {
        return VideoStatus.Upcoming;
      }
    }
  }
  return VideoStatus.Video;
}
