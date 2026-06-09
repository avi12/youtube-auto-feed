import { coverBlankImages } from "./mirror-blank-cover";
import { REMOVAL_SETTLE_FRAMES_MAX, REMOVAL_STABLE_FRAMES } from "./mirror-constants";
import { inlineDomVideoIds } from "./mirror-elements";
import { hideNewInsertedTiles } from "./mirror-entrances";
import { pinSurvivorsToOldRects } from "./mirror-survivors";
import { repaintInlineThumbnails } from "./mirror-thumbnails";

type SettleParams = {
  expectedInlineIds: string;
  oldRects: Map<string, DOMRect>;
  newlyInsertedIds: Set<string>;
};

// Hold survivors at their old rects every frame until the grid's inline order has matched the API for
// REMOVAL_STABLE_FRAMES consecutive frames, at which point Polymer's deferred rebind has settled.
export async function settlePinnedSurvivors({ expectedInlineIds, oldRects, newlyInsertedIds }: SettleParams) {
  const pinParams = {
    oldRects,
    newlyInsertedIds
  };
  let stableFrames = inlineDomVideoIds() === expectedInlineIds ? 1 : 0;
  for (let i = 0; i < REMOVAL_SETTLE_FRAMES_MAX - 1 && stableFrames < REMOVAL_STABLE_FRAMES; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => {
      hideNewInsertedTiles(newlyInsertedIds);
      repaintInlineThumbnails();
      coverBlankImages();
      pinSurvivorsToOldRects(pinParams);
      resolve();
    }));
    stableFrames = inlineDomVideoIds() === expectedInlineIds ? stableFrames + 1 : 0;
  }
}
