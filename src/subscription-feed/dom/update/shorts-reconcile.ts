import type { Prettify } from "../../types/prettify";
import type { VideoSnapshot } from "../../types/video";
import { isPolymerElement } from "../../utils/polymer";
import { videoIdFromData } from "../../utils/video-id";
import { isInViewport } from "../animations";
import { isThumbnailChanged } from "../rich-item";
import { applyWithDissolve } from "./dissolve";
import { changingShortsTextElements, readShortsRenderedText, updateShortsTextFields } from "./text-fields";
import { crossfadeThumbnail, findThumbnailImgInItem, isTileHovered } from "./thumbnail";

// A shorts shelf tile renders through a component that never re-reads the grid model, so writing the
// model leaves the visible title, view count and picture on their old values. The metadata diff cannot
// see that: it compares the freshly fetched values against the stored snapshot, which the model write
// already advanced, so it finds no change and the tile stays stale for as long as it is on the page.
//
// Reconciling against what the tile actually displays closes the gap. Whatever the shelf shows is
// compared with the fresh values every poll and patched in place, so a short heals itself no matter how
// its model and snapshot drifted apart. Hovered tiles are skipped so an open preview is left alone.

function shortsTileElements() {
  const tiles: HTMLElement[] = [];
  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    const isShortsTile = isPolymerElement(elItem)
      && elItem.querySelector("ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model") !== null;
    if (isShortsTile) {
      tiles.push(elItem);
    }
  }
  return tiles;
}

type ReconcileShortsTileParams = Prettify<{
  elItem: HTMLElement;
  fresh: Prettify<VideoSnapshot>;
}>;

async function reconcileShortsTile({ elItem, fresh }: ReconcileShortsTileParams) {
  const rendered = readShortsRenderedText(elItem);
  const textElements = changingShortsTextElements({
    elItem,
    fresh
  });

  const elImg = findThumbnailImgInItem(elItem);
  const paintedUrl = elImg?.getAttribute("src") ?? "";
  const isPictureStale = !!elImg && isThumbnailChanged({
    previousUrl: paintedUrl,
    freshUrl: fresh.thumbnailUrl,
    freshStatus: fresh.status
  });

  const isTextStale = textElements.length > 0
    || (fresh.title !== "" && rendered.title !== fresh.title)
    || rendered.viewCountText !== fresh.viewCountText;
  if (!isTextStale && !isPictureStale) {
    return;
  }

  if (isPictureStale && elImg) {
    await crossfadeThumbnail({
      elImg,
      src: fresh.thumbnailUrl
    });
  }

  if (!isTextStale) {
    return;
  }

  // Off-screen tiles still get the corrected text, just without the dissolve - animating something
  // nobody is looking at buys nothing, and leaving it stale would show the old numbers the moment it
  // scrolls into view.
  if (!isInViewport(elItem)) {
    updateShortsTextFields({
      elItem,
      fresh
    });
    return;
  }

  applyWithDissolve({
    elements: [...textElements],
    apply() {
      updateShortsTextFields({
        elItem,
        fresh
      });
    }
  });
}

export function reconcileShortsMetadata(freshSnapshots: Prettify<VideoSnapshot>[]) {
  const tiles = shortsTileElements();
  if (tiles.length === 0) {
    return;
  }

  const freshByVideoId = new Map(freshSnapshots.map(fresh => [fresh.videoId, fresh]));
  for (const elItem of tiles) {
    if (isTileHovered(elItem)) {
      continue;
    }

    const videoId = isPolymerElement(elItem) ? videoIdFromData(elItem.data) : null;
    const fresh = videoId === null ? undefined : freshByVideoId.get(videoId);
    if (!fresh) {
      continue;
    }

    reconcileShortsTile({
      elItem,
      fresh
    }).catch(() => {});
  }
}
