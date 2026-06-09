import type { Prettify } from "../../types/prettify";

// Locating the thumbnail <img> across shadow-DOM lockups and legacy markup, plus the watch-progress
// bar, which lives in the same shadow tree.

function findImgInYtImages(root: ShadowRoot | HTMLElement, selector: string) {
  for (const elYtImage of root.querySelectorAll<HTMLElement>(selector)) {
    const elImg = elYtImage.shadowRoot?.querySelector<HTMLImageElement>("img")
      ?? elYtImage.querySelector<HTMLImageElement>("img");
    if (elImg) {
      return elImg;
    }
  }
  return null;
}

export function findThumbnailImg(elLockup: HTMLElement) {
  const root: ShadowRoot | HTMLElement = elLockup.shadowRoot ?? elLockup;
  // Prefer yt-thumbnail-view-model's <img> over a bare yt-image (channel avatar or lazy slot
  // left mid-rebind) - writing src to a non-visible yt-image leaves the tile showing the wrong image.
  const elThumbnailViewModelImg = root.querySelector<HTMLImageElement>("yt-thumbnail-view-model img");
  if (elThumbnailViewModelImg) {
    return elThumbnailViewModelImg;
  }

  return findImgInYtImages(root, "yt-image");
}

type ApplyProgressBarUpdateParams = Prettify<{
  elLockup: HTMLElement;
  percent: number | null;
}>;

export function applyProgressBarUpdate({ elLockup, percent }: ApplyProgressBarUpdateParams) {
  if (percent === null) {
    return false;
  }

  const root: ShadowRoot | HTMLElement = elLockup.shadowRoot ?? elLockup;
  const elProgressHost = root.querySelector<HTMLElement>("yt-thumbnail-overlay-progress-bar-view-model");
  if (!elProgressHost) {
    return false;
  }

  const fillRoot: ShadowRoot | HTMLElement = elProgressHost.shadowRoot ?? elProgressHost;
  const elFill = fillRoot.querySelector<HTMLElement>(":scope > div > div");
  if (!elFill) {
    return false;
  }

  elFill.style.width = `${percent}%`;
  return true;
}

export function findThumbnailImgInItem(elItem: HTMLElement) {
  const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
  if (elLockup) {
    const elImg = findThumbnailImg(elLockup);
    if (elImg) {
      return elImg;
    }
  }

  return findImgInYtImages(elItem, "ytd-thumbnail yt-image");
}
