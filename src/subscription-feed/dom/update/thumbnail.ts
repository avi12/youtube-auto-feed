import { isAnimationsEnabled } from "../../settings-state";
import type { Prettify } from "../../types/prettify";

// Thumbnail handling: locating the <img> across shadow-DOM lockups and legacy markup, deciding
// whether the picture changed, and preparing the dissolve crossfade. YouTube's sqp/rs query params
// rotate on CDN re-sign independently of the image bytes - only the path is stable per picture.
// Also handles the watch-progress bar, which lives in the same shadow tree.

export function findThumbnailImg(elLockup: HTMLElement) {
  const root: ShadowRoot | HTMLElement = elLockup.shadowRoot ?? elLockup;
  // Prefer yt-thumbnail-view-model's <img> over a bare yt-image (channel avatar or lazy slot
  // left mid-rebind) - writing src to a non-visible yt-image leaves the tile showing the wrong image.
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

// Decides whether to dissolve to the new thumbnail. Skips if the user is hovering (don't disrupt
// the hover preview) or the painted URL already matches (same picture).
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

const THUMBNAIL_DISSOLVE_MS = 250;

// Cross-fades the <img> from its current picture to the new one. The old picture is held as a CSS
// background while the new src loads at opacity:0; once decoded, the foreground fades in. A view
// transition would be cleaner but doesn't animate on Firefox - its snapshot captures the <img>
// before the new src repaints, collapsing the blend to a hard swap. This live-DOM approach works
// everywhere and never flashes.
export async function dissolveThumbnail(elImg: HTMLImageElement, newUrl: string) {
  if (!isAnimationsEnabled()) {
    elImg.src = newUrl;
    return;
  }

  const oldUrl = elImg.currentSrc || elImg.src;
  const { style } = elImg;
  style.backgroundImage = `url("${oldUrl}")`;
  style.backgroundSize = "cover";
  style.backgroundPosition = "center";
  style.transition = "none";
  style.opacity = "0";
  elImg.src = newUrl;
  // Force a layout flush so the opacity:0 start state is committed before the transition runs.
  elImg.getBoundingClientRect();
  await elImg.decode().catch(() => undefined);

  style.transition = `opacity ${THUMBNAIL_DISSOLVE_MS}ms ease`;
  style.opacity = "1";
  await new Promise<void>(resolve => {
    elImg.addEventListener("transitionend", () => resolve(), { once: true });
    setTimeout(resolve, THUMBNAIL_DISSOLVE_MS + 100);
  });

  style.backgroundImage = "";
  style.backgroundSize = "";
  style.backgroundPosition = "";
  style.transition = "";
  style.opacity = "";
}
