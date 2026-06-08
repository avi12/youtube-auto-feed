import { z } from "../../shared/zod";
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
  type ShortsLockupViewModel
} from "../types/innertube";
import type { Prettify } from "../types/prettify";
import { VideoStatus } from "../types/video";

// Type guards for InnerTube renderer shapes. Schemas assert only the discriminating fields;
// `looseObject` lets the rest of the (large, variable) renderer pass through untouched.

export const videoRendererSchema = z.looseObject({ videoId: z.string() });
const lockupViewModelSchema = z.looseObject({ contentId: z.string() });
const shortsLockupViewModelSchema = z.looseObject({ onTap: z.looseObject({}) });
const browseResponseSchema = z.looseObject({ contents: z.looseObject({}) });
const richShelfRendererSchema = z.looseObject({
  title: z.looseObject({}),
  contents: z.array(z.looseObject({}))
});
const shelfRendererSchema = z.looseObject({
  title: z.looseObject({}),
  content: z.looseObject({})
});

export function isVideoRenderer(value: unknown): value is InnerTubeVideoRenderer {
  return videoRendererSchema.safeParse(value).success;
}

export function isLockupViewModel(value: unknown): value is LockupViewModel {
  return lockupViewModelSchema.safeParse(value).success;
}

export function isShortsLockupViewModel(value: unknown): value is ShortsLockupViewModel {
  return shortsLockupViewModelSchema.safeParse(value).success;
}

export function isInnerTubeBrowseResponse(value: unknown): value is InnerTubeBrowseResponse {
  return browseResponseSchema.safeParse(value).success;
}

export function isRichShelfRenderer(value: unknown): value is InnerTubeRichShelfRenderer {
  return richShelfRendererSchema.safeParse(value).success;
}

export function isShelfRenderer(value: unknown): value is InnerTubeShelfRenderer {
  return shelfRendererSchema.safeParse(value).success;
}

// View count lives in `viewCountText.simpleText`, `viewCountText.runs`, or `shortViewCountText` - use whichever is set.
export function viewCountFromRenderer(renderer: Prettify<InnerTubeVideoRenderer>) {
  const { viewCountText, shortViewCountText } = renderer;
  const { simpleText, runs } = viewCountText ?? {};
  return simpleText
    ?? runs?.map(({ text }) => text).join("")
    ?? shortViewCountText?.simpleText
    ?? "";
}

// Maps live/upcoming/short signals from videoRenderer onto VideoStatus.
export function statusFromRenderer(renderer: Prettify<InnerTubeVideoRenderer>) {
  const {
    badges, thumbnailOverlays, navigationEndpoint, upcomingEventData, publishedTimeText
  } = renderer;
  const badgeStyle = badges
    ?.find(badge => badge.metadataBadgeRenderer)
    ?.metadataBadgeRenderer?.style;
  const overlayStyle = thumbnailOverlays
    ?.find(overlay => overlay.thumbnailOverlayTimeStatusRenderer)
    ?.thumbnailOverlayTimeStatusRenderer?.style;
  const isLive = badgeStyle === BadgeStyle.LiveNow || overlayStyle === OverlayStyle.Live;
  if (isLive) {
    return VideoStatus.Live;
  }

  // publishedTimeText wins over stale badge/eventData: YouTube sets "Streamed X ago" before clearing upcomingEventData.
  const isStreamedAgo = publishedTimeText?.simpleText?.toLowerCase().startsWith("streamed") ?? false;
  const hasUpcomingSignal = badgeStyle === BadgeStyle.Upcoming
    || overlayStyle === OverlayStyle.Upcoming
    || upcomingEventData !== undefined;
  if (!isStreamedAgo && hasUpcomingSignal) {
    return VideoStatus.Upcoming;
  }

  if (navigationEndpoint?.reelWatchEndpoint !== undefined) {
    return VideoStatus.Short;
  }

  return VideoStatus.Video;
}

// Same as statusFromRenderer but for the lockupViewModel shape.
export function statusFromLockup(lockup: Prettify<LockupViewModel>) {
  const { contentType, contentImage } = lockup;
  if (contentType === LockupContentType.Shorts) {
    return VideoStatus.Short;
  }

  const overlays = contentImage?.thumbnailViewModel?.overlays ?? [];
  for (const overlay of overlays) {
    for (const badge of overlay.thumbnailBottomOverlayViewModel?.badges ?? []) {
      const { badgeStyle, text } = badge.thumbnailBadgeViewModel ?? {};
      if (badgeStyle === LockupBadgeStyle.Live) {
        return VideoStatus.Live;
      }

      if (badgeStyle === LockupBadgeStyle.Upcoming) {
        return VideoStatus.Upcoming;
      }

      // Fallback: YouTube sometimes omits badgeStyle but still renders the text label.
      if (text === "Upcoming") {
        return VideoStatus.Upcoming;
      }
    }
  }
  return VideoStatus.Video;
}

// Converts publishedTimeText ("3 hours ago") to seconds for age-based sorting.
// Returns 0 for empty or unrecognised formats (e.g. live videos with no time text).
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
