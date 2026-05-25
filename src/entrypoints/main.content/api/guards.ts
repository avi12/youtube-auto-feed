import { isRecord } from "../helpers";
import {
  BadgeStyle,
  type InnerTubeBrowseResponse,
  type InnerTubeRichShelfRenderer,
  type InnerTubeShelfRenderer,
  type InnerTubeVideoRenderer,
  LockupBadgeStyle,
  LockupContentType,
  type LockupViewModel,
  OverlayStyle,
  type ShortsLockupViewModel,
  VideoStatus
} from "../types";

export function isVideoRenderer(value: unknown): value is InnerTubeVideoRenderer {
  return isRecord(value) && typeof value.videoId === "string";
}

export function isLockupViewModel(value: unknown): value is LockupViewModel {
  return isRecord(value) && typeof value.contentId === "string";
}

export function isShortsLockupViewModel(value: unknown): value is ShortsLockupViewModel {
  return isRecord(value) && isRecord(value.onTap);
}

export function isInnerTubeBrowseResponse(value: unknown): value is InnerTubeBrowseResponse {
  return isRecord(value) && isRecord(value.contents);
}

export function isRichShelfRenderer(value: unknown): value is InnerTubeRichShelfRenderer {
  return isRecord(value) && isRecord(value.title) && Array.isArray(value.contents);
}

export function isShelfRenderer(value: unknown): value is InnerTubeShelfRenderer {
  return isRecord(value) && isRecord(value.title) && isRecord(value.content);
}

export function viewCountFromRenderer(renderer: InnerTubeVideoRenderer) {
  const { viewCountText, shortViewCountText } = renderer;
  return viewCountText?.simpleText
    ?? viewCountText?.runs?.map(({ text }) => text).join("")
    ?? shortViewCountText?.simpleText
    ?? "";
}

export function statusFromRenderer(renderer: InnerTubeVideoRenderer) {
  const {
    badges, thumbnailOverlays, navigationEndpoint, upcomingEventData, publishedTimeText
  } = renderer;
  const badgeStyle = badges
    ?.find(badge => badge.metadataBadgeRenderer)
    ?.metadataBadgeRenderer?.style;
  const overlayStyle = thumbnailOverlays
    ?.find(overlay => overlay.thumbnailOverlayTimeStatusRenderer)
    ?.thumbnailOverlayTimeStatusRenderer?.style;
  if (badgeStyle === BadgeStyle.LiveNow || overlayStyle === OverlayStyle.Live) {
    return VideoStatus.Live;
  }

  // publishedTimeText wins over stale badge/eventData: when a scheduled stream ends,
  // YouTube sets "Streamed X ago" before clearing upcomingEventData or badges.
  const isStreamedAgo = publishedTimeText?.simpleText?.toLowerCase().startsWith("streamed") ?? false;
  if (
    !isStreamedAgo && (
      badgeStyle === BadgeStyle.Upcoming ||
      overlayStyle === OverlayStyle.Upcoming ||
      upcomingEventData !== undefined
    )
  ) {
    return VideoStatus.Upcoming;
  }

  if (navigationEndpoint?.reelWatchEndpoint !== undefined) {
    return VideoStatus.Short;
  }

  return VideoStatus.Video;
}

export function statusFromLockup(lockup: LockupViewModel) {
  if (lockup.contentType === LockupContentType.Shorts) {
    return VideoStatus.Short;
  }

  const overlays = lockup.contentImage?.thumbnailViewModel?.overlays ?? [];
  for (const overlay of overlays) {
    for (const badge of overlay.thumbnailBottomOverlayViewModel?.badges ?? []) {
      const badgeStyle = badge.thumbnailBadgeViewModel?.badgeStyle;
      if (badgeStyle === LockupBadgeStyle.Live) {
        return VideoStatus.Live;
      }

      if (badgeStyle === LockupBadgeStyle.Upcoming) {
        return VideoStatus.Upcoming;
      }

      if (badge.thumbnailBadgeViewModel?.text === "Upcoming") {
        return VideoStatus.Upcoming;
      }
    }
  }
  return VideoStatus.Video;
}

export function parseSecondsAgo(publishedTimeText: string) {
  const match = publishedTimeText.match(/(\d+)\s+(second|minute|hour|day|week|month|year)/);
  if (!match) {
    return 0;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const secondsPerUnit: Record<string, number> = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000
  };
  return value * (secondsPerUnit[unit] ?? 0);
}
