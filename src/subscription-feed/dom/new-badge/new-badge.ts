import {
  type InnerTubeRichGridItem,
  LockupBadgePosition,
  LockupBadgeStyle,
  type LockupThumbnailOverlay,
  type LockupViewModel
} from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { videoIdFromData, videoIdFromLockup } from "../../utils/video-id";
import { isRichGridData } from "../../youtube-api/guards";
import { GRID_SELECTOR, RICH_ITEM_SELECTOR, type RichItemElement } from "../mirror/mirror-constants";
import { videoIdFromRichItem } from "../rich-item";
import { newBadgeText } from "./new-badge-text";

// A video the extension slips into the feed while you are reading it wears the same "New" corner marker
// YouTube puts on a fresh recommendation - the marker is added to the lockup's own overlay list, so the
// page renders YouTube's badge rather than a lookalike of it, in YouTube's own wording for the
// viewer's language.
//
// The badge means "this arrived while you were watching", so it is dropped the moment the video is
// opened and lapses on its own ten minutes later. Lapsing is picked up by the next feed poll instead of
// a timer, and the marked-video map is the single source of truth: every pass rebuilds the overlays
// from it, so a badge can neither linger in the grid model past its video nor survive a re-render.
//
// Only a video that arrives at the front of the band earns the badge, and only the first time the feed
// ever shows it. An insertion on its own does not mean an upload: the API's tail flips videos in and
// out across identical polls, and it also carries videos the page never rendered - an old
// collaboration or a channel trailer - which land deep in the band whenever they first appear. A real
// upload sorts ahead of everything the page already had, so the front of the band, up to the first
// video that was already there, is what "just arrived" means.

const NEW_BADGE_LIFETIME_MS = 10 * 60 * 1000;

export const badgeExpiryByVideoId = new Map<string, number>();
export const seenVideoIds = new Set<string>();

function newBadgeOverlay(): LockupThumbnailOverlay {
  const text = newBadgeText();
  return {
    thumbnailOverlayBadgeViewModel: {
      thumbnailBadges: [{
        thumbnailBadgeViewModel: {
          text,
          badgeStyle: LockupBadgeStyle.Special,
          rendererContext: {
            accessibilityContext: { label: text }
          }
        }
      }],
      position: LockupBadgePosition.TopStart
    }
  };
}

type MarkVideosAsNewParams = Prettify<{
  contents: Prettify<InnerTubeRichGridItem>[];
  previousInlineIds: Set<string>;
  isBadgeable: boolean;
}>;

export function markVideosAsNew({ contents, previousInlineIds, isBadgeable }: MarkVideosAsNewParams) {
  const expiry = Date.now() + NEW_BADGE_LIFETIME_MS;
  let isBandFront = true;
  for (const item of contents) {
    const videoId = videoIdFromRichItem(item);
    if (!videoId) {
      continue;
    }

    const isVideoKnown = seenVideoIds.has(videoId) || previousInlineIds.has(videoId);
    if (isBadgeable && isBandFront && !isVideoKnown) {
      badgeExpiryByVideoId.set(videoId, expiry);
    }

    isBandFront = isBandFront && !previousInlineIds.has(videoId);
    seenVideoIds.add(videoId);
  }
}

function forgetLapsedBadges() {
  const now = Date.now();
  for (const [videoId, expiry] of badgeExpiryByVideoId) {
    if (expiry <= now) {
      badgeExpiryByVideoId.delete(videoId);
    }
  }
}

type ContentImage = LockupViewModel["contentImage"];

function isBadgeCarried(contentImage: ContentImage) {
  return (contentImage?.thumbnailViewModel?.overlays ?? [])
    .some(overlay => overlay.thumbnailOverlayBadgeViewModel);
}

type ContentImageWithBadgeParams = Prettify<{
  contentImage: ContentImage;
  isBadgeWanted: boolean;
}>;

// Returns the same contentImage when the badge is already where it is wanted, so an unchanged tile
// stays reference-equal and nothing re-renders.
function contentImageWithBadge({ contentImage, isBadgeWanted }: ContentImageWithBadgeParams) {
  const thumbnail = contentImage?.thumbnailViewModel;
  if (!thumbnail || isBadgeCarried(contentImage) === isBadgeWanted) {
    return contentImage;
  }

  const overlays = thumbnail.overlays ?? [];
  return {
    ...contentImage,
    thumbnailViewModel: {
      ...thumbnail,
      overlays: isBadgeWanted
        ? [...overlays, newBadgeOverlay()]
        : overlays.filter(overlay => !overlay.thumbnailOverlayBadgeViewModel)
    }
  };
}

type ContentImageWithBadgeStateParams = Prettify<{
  videoId: string | null;
  contentImage: ContentImage;
}>;

// The marked-video map is the single answer to "does this thumbnail wear the badge", and a painter that
// restamps the tile asks it. A painter that carried the API's own overlays instead would drop the badge
// out of the model, and the next poll would put it back by restamping the tile again - a restamped tile
// rebuilds its thumbnail and avatar images, which reads as a flicker every few seconds for as long as
// the badge lives.
export function contentImageWithBadgeState({ videoId, contentImage }: ContentImageWithBadgeStateParams) {
  if (!videoId) {
    return contentImage;
  }

  return contentImageWithBadge({
    contentImage,
    isBadgeWanted: badgeExpiryByVideoId.has(videoId)
  });
}

type ContentImageWithPaintedBadgeParams = Prettify<{
  painted: ContentImage;
  contentImage: ContentImage;
}>;

// A write no element is told about cannot change what the tile paints, so it carries the badge the tile
// already wears rather than the one the map wants. Dropping a lapsed badge here would settle the model
// silently and leave the tile wearing it for good, with nothing left to restamp.
export function contentImageWithPaintedBadge({ painted, contentImage }: ContentImageWithPaintedBadgeParams) {
  return contentImageWithBadge({
    contentImage,
    isBadgeWanted: isBadgeCarried(painted)
  });
}

function itemWithBadgeState(item: Prettify<InnerTubeRichGridItem>) {
  const { richItemRenderer } = item;
  const content = richItemRenderer?.content;
  const lockup = content?.lockupViewModel;
  if (!richItemRenderer || !content || !lockup) {
    return item;
  }

  const contentImage = contentImageWithBadgeState({
    videoId: videoIdFromLockup(lockup),
    contentImage: lockup.contentImage
  });
  if (contentImage === lockup.contentImage) {
    return item;
  }

  return {
    ...item,
    richItemRenderer: {
      ...richItemRenderer,
      content: {
        ...content,
        lockupViewModel: {
          ...lockup,
          contentImage
        }
      }
    }
  };
}

// Returns the same array when no badge moved, so an unchanged feed stays reference-equal and the mirror
// leaves the grid alone.
export function withNewBadges(contents: Prettify<InnerTubeRichGridItem>[]) {
  forgetLapsedBadges();
  const next = contents.map(itemWithBadgeState);
  const isChanged = next.some((item, i) => item !== contents[i]);
  return isChanged ? next : contents;
}

function repaintNewBadges() {
  const elGrid = document.querySelector<PolymerElement>(GRID_SELECTOR);
  if (!elGrid || !isRichGridData(elGrid.data)) {
    return;
  }

  const { contents = [] } = elGrid.data;
  const next = withNewBadges(contents);
  if (next !== contents) {
    elGrid.set("data.contents", next);
  }
}

function dismissBadgeOfPressedVideo(e: Event) {
  const elTarget = e.target;
  if (!(elTarget instanceof Element)) {
    return;
  }

  const elItem = elTarget.closest<RichItemElement>(RICH_ITEM_SELECTOR);
  const videoId = elItem && videoIdFromData(elItem.data);
  if (!videoId || !badgeExpiryByVideoId.delete(videoId)) {
    return;
  }

  repaintNewBadges();
}

export function startNewBadgeDismissal() {
  document.addEventListener("pointerdown", dismissBadgeOfPressedVideo, true);
}
