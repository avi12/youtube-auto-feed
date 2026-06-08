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

// Type guards for the different InnerTube renderer shapes a feed item might be.
// These distinguish a video renderer from a Shorts lockup from a "regular" lockup, etc.
// The schemas only assert the discriminating fields; `looseObject` lets the rest of the
// (huge, variable) renderer pass through untouched, matching the deep-accessor contract.

const videoRendererSchema = z.looseObject({ videoId: z.string() });
const lockupViewModelSchema = z.looseObject({ contentId: z.string() });
const shortsLockupViewModelSchema = z.looseObject({ onTap: z.looseObject({}) });
const browseResponseSchema = z.looseObject({ contents: z.looseObject({}) });
const richShelfRendererSchema = z.looseObject({
  title: z.looseObject({}),
  contents: z.array(z.unknown())
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

// Some videoRenderer payloads put the view count in `viewCountText`, others in `runs`, others
// only in `shortViewCountText`. This pulls whichever one is populated.
export function viewCountFromRenderer(renderer: Prettify<InnerTubeVideoRenderer>) {
  const { viewCountText, shortViewCountText } = renderer;
  const { simpleText, runs } = viewCountText ?? {};
  return simpleText
    ?? runs?.map(({ text }) => text).join("")
    ?? shortViewCountText?.simpleText
    ?? "";
}

// Maps the various live/upcoming/short signals YouTube emits onto our normalized VideoStatus enum.
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

  // publishedTimeText wins over stale badge/eventData: when a scheduled stream ends, YouTube sets
  // "Streamed X ago" before clearing upcomingEventData or badges.
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

// Same idea as statusFromRenderer but for the newer lockupViewModel shape.
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

      // Fallback when YouTube omits the structured badgeStyle but still renders the label.
      if (text === "Upcoming") {
        return VideoStatus.Upcoming;
      }
    }
  }
  return VideoStatus.Video;
}

// Converts a human-readable publishedTimeText ("3 hours ago") into seconds, so we can sort by age.
// Returns 0 for empty strings and unrecognised formats (e.g. live videos with no time text).
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
