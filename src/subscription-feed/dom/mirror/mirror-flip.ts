import { flushPolymerRender, isPolymerElement } from "../../utils/polymer";
import { coverBlankImages, observeAndCoverBlankImages } from "./mirror-blank-cover";
import {
  REBIND_FRAME_POLL_MAX,
  REBIND_MICROTASK_POLL_MAX,
  SURVIVOR_SHIFT_MS,
  type SetContentsParams
} from "./mirror-constants";
import { clearReflowImageCovers, preCoverReflowImages } from "./mirror-cover";
import { coverNewlyInsertedTiles } from "./mirror-cover-new";
import { recordReflowZoneRects } from "./mirror-elements";
import { animateNewEntrances, areInsertedTilesPresent, hideNewInsertedTiles } from "./mirror-entrances";
import { clearRemovalGhosts, dissolveRemovalGhosts } from "./mirror-ghosts";
import { pinSurvivorsToOldRects, releaseSurvivors } from "./mirror-survivors";
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
  const oldRects = recordReflowZoneRects();

  await new Promise<void>(resolve =>
    requestAnimationFrame(() => {
      elGrid.set("data.contents", newContents);
      flushPolymerRender();
      hideNewInsertedTiles(newlyInsertedIds);
      repaintInlineThumbnails();
      coverBlankImages();
      resolve();
    }));

  function newTilesPending() {
    return newlyInsertedIds.size > 0 && !areInsertedTilesPresent(newlyInsertedIds);
  }
  for (let i = 0; newTilesPending() && i < REBIND_MICROTASK_POLL_MAX; i++) {
    await Promise.resolve();
  }
  for (let i = 0; newTilesPending() && i < REBIND_FRAME_POLL_MAX; i++) {
    await nextFrame();
    hideNewInsertedTiles(newlyInsertedIds);
  }

  // Pin only after Polymer has stamped the new tiles: on Firefox the grid reflows asynchronously, so
  // pinning inside the write frame measured a not-yet-shifted layout (delta 0 = no glide). The extra
  // frame lets the pinned offset paint before the release transition starts.
  pinSurvivorsToOldRects({
    oldRects,
    newlyInsertedIds
  });
  hideNewInsertedTiles(newlyInsertedIds);
  await nextFrame();

  releaseSurvivors();
  dissolveRemovalGhosts(removalGhosts);
  repaintInlineThumbnails();
  coverBlankImages();
  coverNewlyInsertedTiles({
    newlyInsertedIds,
    newThumbnailUrls
  });
  animateNewEntrances(newlyInsertedIds);

  const animFrames = Math.ceil(SURVIVOR_SHIFT_MS / MILLISECONDS_PER_FRAME) + GLIDE_FRAME_BUFFER;
  for (let iFrame = 0; iFrame < animFrames; iFrame++) {
    await nextFrame();
  }
  imageCoverObserver?.disconnect();
  clearReflowImageCovers();
  clearRemovalGhosts();
}
