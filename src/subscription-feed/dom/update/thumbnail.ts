import type { Prettify } from "../../types/prettify";

// Thumbnail handling: finding the <img> element across both shadow-DOM lockups and the legacy
// markup, comparing bytes (not just URLs - YouTube sometimes rotates the query string without
// changing the image), and preparing the dissolve crossfade. Also handles the watch-progress
// bar fill since it lives inside the same shadow tree.

const FETCH_CHUNK_SIZE = 8192;

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

async function fetchImageBase64(url: string) {
  // Fetch the full URL: the sqp/rs query selects the actual crop/variant, so stripping it would
  // compare the base image and miss a same-path thumbnail change.
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = FETCH_CHUNK_SIZE;
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

type AreThumbnailsDifferentParams = Prettify<{
  currentSrc: string;
  newSrc: string;
}>;

async function areThumbnailsDifferent({ currentSrc, newSrc }: AreThumbnailsDifferentParams) {
  if (currentSrc === newSrc) {
    return false;
  }

  try {
    const [currentBase64, newBase64] = await Promise.all([
      fetchImageBase64(currentSrc),
      fetchImageBase64(newSrc)
    ]);
    const lacksBase64 = currentBase64 === null || newBase64 === null;
    if (lacksBase64) {
      return true;
    }

    return currentBase64 !== newBase64;
  } catch {
    return true;
  }
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
// the item (so we don't disrupt the hover preview), or if the new bytes are identical to
// the current ones (URL changed but the picture didn't).
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

  const isDifferent = await areThumbnailsDifferent({
    currentSrc: elImg.src,
    newSrc: newUrl
  });
  if (!isDifferent) {
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
