import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";

export const REBIND_MICROTASK_POLL_MAX = 20;
export const REBIND_FRAME_POLL_MAX = 10;
export const THUMBNAIL_REASSERT_FRAMES_MAX = 120;
export const THUMBNAIL_STABLE_FRAMES = 5;
// ~3s at 60fps: how long the entrance animation waits for a new tile's thumbnail to decode before
// giving up, so slow connections do not animate a blank tile in.
export const NEW_THUMBNAIL_DECODE_CAP_FRAMES = 180;
export const GRID_ITEM_SELECTOR = "ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer";
// Collaborative (multi-channel) videos flicker in the API's noisy pagination tail, so they are
// buffered for this many polls before removal. Non-collaborative videos are dropped immediately.
export const STICKY_DELETE_POLLS = 10;
export const SURVIVOR_SHIFT_MS = 380;
export const REFLOW_MARGIN_BELOW_PX = 1200;
export const absenceCountByVideoId = new Map<string, number>();

export type RichItemElement = PolymerElement<NonNullable<InnerTubeRichGridItem["richItemRenderer"]>>;

export type SetContentsParams = Prettify<{
  elGrid: HTMLElement;
  newContents: Prettify<InnerTubeRichGridItem>[];
  newlyInsertedIds: Set<string>;
  newThumbnailUrls: Map<string, string>;
  removalGhosts: HTMLElement[];
}>;
