import { flushPolymerRender, isPolymerElement } from "../utils/polymer";
import { coverBlankImages, observeAndCoverBlankImages } from "./mirror-blank-cover";
import { SURVIVOR_SHIFT_MS, type SetContentsParams } from "./mirror-constants";
import { clearReflowImageCovers, preCoverReflowImages } from "./mirror-cover";
import { coverNewlyInsertedTiles } from "./mirror-cover-new";
import { recordReflowZoneRects } from "./mirror-elements";
import { animateNewEntrances, hideNewInsertedTiles } from "./mirror-entrances";
import { clearRemovalGhosts, dissolveRemovalGhosts } from "./mirror-ghosts";
import { settlePinnedSurvivors } from "./mirror-settle";
import { pinSurvivorsToOldRects, releaseSurvivors } from "./mirror-survivors";
import { repaintInlineThumbnails } from "./mirror-thumbnails";
import { videoIdFromRichItem } from "./rich-item";

function nextFrame() {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

const MILLISECONDS_PER_FRAME = 16;
const GLIDE_FRAME_BUFFER = 2;

export async function setContentsWithFlip(
  { elGrid, newContents, newlyInsertedIds, newThumbnailUrls, removalGhosts }: SetContentsParams
) {
  if (!isPolymerElement(elGrid)) {
    return;
  }

  const expectedInlineIds = newContents
    .map(videoIdFromRichItem)
    .filter((id): id is string => !!id)
    .join();

  const imageCoverObserver = observeAndCoverBlankImages(elGrid);

  await nextFrame();
  preCoverReflowImages(newContents, newlyInsertedIds);

  const oldRects = await new Promise<Map<string, DOMRect>>(resolve =>
    requestAnimationFrame(() => {
      const rects = recordReflowZoneRects();
      elGrid.set("data.contents", newContents);
      flushPolymerRender();
      hideNewInsertedTiles(newlyInsertedIds);
      repaintInlineThumbnails();
      coverBlankImages();
      pinSurvivorsToOldRects({
        oldRects: rects,
        newlyInsertedIds
      });
      resolve(rects);
    }));

  await settlePinnedSurvivors({
    expectedInlineIds,
    oldRects,
    newlyInsertedIds
  });

  releaseSurvivors();
  dissolveRemovalGhosts(removalGhosts);
  repaintInlineThumbnails();
  coverBlankImages();
  coverNewlyInsertedTiles({
    newlyInsertedIds,
    newThumbnailUrls
  });
  animateNewEntrances(newlyInsertedIds);

  const glideFrames = Math.ceil(SURVIVOR_SHIFT_MS / MILLISECONDS_PER_FRAME) + GLIDE_FRAME_BUFFER;
  for (let frame = 0; frame < glideFrames; frame++) {
    await nextFrame();
  }
  imageCoverObserver?.disconnect();
  clearReflowImageCovers();
  clearRemovalGhosts();
}
