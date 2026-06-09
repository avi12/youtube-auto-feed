import {
  GRID_ITEM_SELECTOR,
  REBIND_FRAME_POLL_MAX,
  REBIND_MICROTASK_POLL_MAX,
  THUMBNAIL_REASSERT_FRAMES_MAX,
  THUMBNAIL_STABLE_FRAMES,
  type RichItemElement
} from "./mirror-constants";
import { avatarImgInItem, thumbnailImgsInItem } from "./mirror-elements";
import { areInsertedTilesPresent } from "./mirror-entrances";
import { avatarUrlFromContent, thumbnailUrlFromContent } from "./rich-item";

function pathWithoutQuery(url: string) {
  return url.split("?")[0];
}

export function repaintInlineThumbnails() {
  let correctionCount = 0;
  for (const elItem of document.querySelectorAll<RichItemElement>(GRID_ITEM_SELECTOR)) {
    const { content } = elItem.data;

    const thumbnailUrl = thumbnailUrlFromContent(content);
    if (thumbnailUrl) {
      for (const elImg of thumbnailImgsInItem(elItem)) {
        if (pathWithoutQuery(elImg.src) !== pathWithoutQuery(thumbnailUrl)) {
          elImg.src = thumbnailUrl;
          correctionCount++;
        }
      }
    }

    const avatarUrl = avatarUrlFromContent(content);
    if (avatarUrl) {
      const elAvatarImg = avatarImgInItem(elItem);
      if (elAvatarImg && pathWithoutQuery(elAvatarImg.src) !== pathWithoutQuery(avatarUrl)) {
        elAvatarImg.src = avatarUrl;
        correctionCount++;
      }
    }
  }
  return correctionCount;
}

export async function repaintInsertedThumbnails(newlyInsertedIds: Set<string>) {
  // Polymer debounces dom-repeat rebind across microtasks then frames; wait for the new tiles to
  // exist before repainting so early passes do not run against a half-rendered grid.
  for (let i = 0; i < REBIND_MICROTASK_POLL_MAX && !areInsertedTilesPresent(newlyInsertedIds); i++) {
    await Promise.resolve();
  }
  for (let i = 0; i < REBIND_FRAME_POLL_MAX && !areInsertedTilesPresent(newlyInsertedIds); i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }

  let stableFrames = 0;
  for (let i = 0; i < THUMBNAIL_REASSERT_FRAMES_MAX && stableFrames < THUMBNAIL_STABLE_FRAMES; i++) {
    const correctionCount = repaintInlineThumbnails();
    stableFrames = correctionCount === 0 ? stableFrames + 1 : 0;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}
