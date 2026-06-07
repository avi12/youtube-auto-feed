import type { Prettify } from "../../types/prettify";
import { prefersReducedMotion } from "../animations";

// Thumbnail handling: finding the <img> element across both shadow-DOM lockups and the legacy
// markup, deciding whether the picture actually changed, and preparing the dissolve crossfade.
// The sqp/rs query params in YouTube's thumbnail URLs rotate on CDN re-sign independently of the
// actual image bytes - only the path portion is stable per picture. Also handles the watch-progress
// bar fill since it lives inside the same shadow tree.

export function findThumbnailImg(elLockup: HTMLElement) {
  const root: ShadowRoot | HTMLElement = elLockup.shadowRoot ?? elLockup;
  // The visible lockup thumbnail is the <img> inside yt-thumbnail-view-model. Prefer it over any
  // bare yt-image (the channel avatar, or an empty/lazy thumbnail slot left mid-rebind): writing
  // src to a non-visible yt-image leaves the painted tile showing the previous occupant's image.
  const elThumbnailViewModelImg = root.querySelector<HTMLImageElement>("yt-thumbnail-view-model img");
  if (elThumbnailViewModelImg) {
    return elThumbnailViewModelImg;
  }

  for (const elYtImage of root.querySelectorAll<HTMLElement>("yt-image")) {
    const elImg = elYtImage.shadowRoot?.querySelector<HTMLImageElement>("img")
      ?? elYtImage.querySelector<HTMLImageElement>("img");
    if (elImg) {
      return elImg;
    }
  }
  return null;
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

  for (const elYtImage of elItem.querySelectorAll<HTMLElement>("ytd-thumbnail yt-image")) {
    const elImg = elYtImage.shadowRoot?.querySelector<HTMLImageElement>("img")
      ?? elYtImage.querySelector<HTMLImageElement>("img");
    if (elImg) {
      return elImg;
    }
  }
  return null;
}

function preloadImage(url: string) {
  return new Promise<void>(resolve => {
    const preload = new Image();
    preload.onload = () => resolve();
    preload.onerror = () => resolve();
    preload.src = url;
  });
}

// Decides whether to dissolve to the new thumbnail. Skips dissolve if the user is hovering
// the item (so we don't disrupt the hover preview), or if the painted URL already matches the
// new one (same picture).
type PrepareThumbnailDissolveParams = Prettify<{
  elItem: HTMLElement;
  elImg: HTMLImageElement;
  newUrl: string;
}>;

export async function prepareThumbnailDissolve({ elItem, elImg, newUrl }: PrepareThumbnailDissolveParams) {
  if (elItem.matches(":hover")) {
    return {
      willDissolve: false,
      newUrl
    };
  }

  if (elImg.src.split("?")[0] === newUrl.split("?")[0]) {
    return {
      willDissolve: false,
      newUrl
    };
  }

  await preloadImage(newUrl);

  if (elItem.matches(":hover")) {
    return {
      willDissolve: false,
      newUrl
    };
  }

  return {
    willDissolve: true,
    newUrl
  };
}

const THUMBNAIL_VT_NAME_PREFIX = "ytsua-thumb-";

// Cross-dissolves to a new thumbnail via a named View Transition. The browser captures the old
// and new painted frames of the <img> and blends them - this works across shadow-root boundaries
// because VT operates on composited output, not on the CSS class mechanism.
export async function dissolveThumbnail(elImg: HTMLImageElement, newUrl: string, videoId: string) {
  if (prefersReducedMotion() || !document.startViewTransition) {
    elImg.src = newUrl;
    return;
  }

  elImg.style.viewTransitionName = `${THUMBNAIL_VT_NAME_PREFIX}${videoId}`;
  const transition = document.startViewTransition(() => {
    elImg.src = newUrl;
  });
  await transition.finished;
  elImg.style.viewTransitionName = "";
}
