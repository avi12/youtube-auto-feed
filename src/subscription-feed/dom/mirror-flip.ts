import { flushPolymerRender, isPolymerElement } from "../utils/polymer";
import { coverBlankImages, observeAndCoverBlankImages } from "./mirror-blank-cover";
import { SURVIVOR_SHIFT_MS, type SetContentsParams } from "./mirror-constants";
import { clearReflowImageCovers, preCoverReflowImages } from "./mirror-cover";
import { coverNewlyInsertedTiles } from "./mirror-cover-new";
import { animateNewEntrances, hideNewInsertedTiles } from "./mirror-entrances";
import { clearRemovalGhosts, dissolveRemovalGhosts } from "./mirror-ghosts";
import { repaintInlineThumbnails } from "./mirror-thumbnails";

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

  const imageCoverObserver = observeAndCoverBlankImages(elGrid);

  await nextFrame();
  preCoverReflowImages(newContents, newlyInsertedIds);

  await new Promise<void>(resolve =>
    requestAnimationFrame(() => {
      elGrid.set("data.contents", newContents);
      flushPolymerRender();
      hideNewInsertedTiles(newlyInsertedIds);
      repaintInlineThumbnails();
      coverBlankImages();
      resolve();
    }));

  dissolveRemovalGhosts(removalGhosts);
  repaintInlineThumbnails();
  coverBlankImages();
  coverNewlyInsertedTiles({
    newlyInsertedIds,
    newThumbnailUrls
  });
  animateNewEntrances(newlyInsertedIds);

  const animFrames = Math.ceil(SURVIVOR_SHIFT_MS / MILLISECONDS_PER_FRAME) + GLIDE_FRAME_BUFFER;
  for (let frame = 0; frame < animFrames; frame++) {
    await nextFrame();
  }
  imageCoverObserver?.disconnect();
  clearReflowImageCovers();
  clearRemovalGhosts();
}
