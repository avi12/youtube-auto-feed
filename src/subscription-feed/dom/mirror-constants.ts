import type { InnerTubeRichGridItem } from "../types/innertube";
import type { PolymerElement } from "../types/polymer";
import type { Prettify } from "../types/prettify";

export const REBIND_MICROTASK_POLL_MAX = 20;
export const REBIND_FRAME_POLL_MAX = 10;
export const THUMBNAIL_REASSERT_FRAMES_MAX = 120;
export const THUMBNAIL_STABLE_FRAMES = 5;
export const GRID_ITEM_SELECTOR = "ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer";
// Collaborative (multi-channel) videos flicker in the API's noisy pagination tail, so they are
// buffered for this many polls before removal. Non-collaborative videos are dropped immediately.
export const STICKY_DELETE_POLLS = 4;
export const SURVIVOR_SHIFT_MS = 380;
export const GHOST_DISSOLVE_MS = 250;
export const REFLOW_MARGIN_BELOW_PX = 1200;
export const FLIP_MAX_GLIDE_PX = 600;
export const absenceCountByVideoId = new Map<string, number>();

export type RichItemElement = PolymerElement<NonNullable<InnerTubeRichGridItem["richItemRenderer"]>>;

export type SetContentsParams = Prettify<{
  elGrid: HTMLElement;
  newContents: Prettify<InnerTubeRichGridItem>[];
  newlyInsertedIds: Set<string>;
  newThumbnailUrls: Map<string, string>;
  removalGhosts: HTMLElement[];
}>;
