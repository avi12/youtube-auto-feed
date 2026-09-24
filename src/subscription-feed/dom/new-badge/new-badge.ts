import {
  type InnerTubeRichGridItem,
  LockupBadgePosition,
  LockupBadgeStyle,
  type LockupThumbnailOverlay
} from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { videoIdFromData } from "../../utils/video-id";
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

type ItemWithOverlaysParams = Prettify<{
  item: Prettify<InnerTubeRichGridItem>;
  overlays: LockupThumbnailOverlay[];
}>;

function itemWithOverlays({ item, overlays }: ItemWithOverlaysParams) {
  const itemCopy = structuredClone(item);
  const thumbnail = itemCopy.richItemRenderer?.content?.lockupViewModel?.contentImage?.thumbnailViewModel;
  if (!thumbnail) {
    return item;
  }

  thumbnail.overlays = overlays;
  return itemCopy;
}

function itemWithBadgeState(item: Prettify<InnerTubeRichGridItem>) {
  const videoId = videoIdFromRichItem(item);
  const thumbnail = item.richItemRenderer?.content?.lockupViewModel?.contentImage?.thumbnailViewModel;
  if (!videoId || !thumbnail) {
    return item;
  }

  const overlays = thumbnail.overlays ?? [];
  const isBadgeRendered = overlays.some(overlay => overlay.thumbnailOverlayBadgeViewModel);
  const isBadgeWanted = badgeExpiryByVideoId.has(videoId);
  if (isBadgeRendered === isBadgeWanted) {
    return item;
  }

  return itemWithOverlays({
    item,
    overlays: isBadgeWanted
      ? [...overlays, newBadgeOverlay()]
      : overlays.filter(overlay => !overlay.thumbnailOverlayBadgeViewModel)
  });
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
