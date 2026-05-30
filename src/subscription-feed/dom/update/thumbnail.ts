// Thumbnail handling: finding the <img> element across both shadow-DOM lockups and the legacy
// markup, comparing bytes (not just URLs - YouTube sometimes rotates the query string without
// changing the image), and preparing the dissolve crossfade. Also handles the watch-progress
// bar fill since it lives inside the same shadow tree.

const FETCH_CHUNK_SIZE = 8192;

export function findThumbnailImg(elLockup: HTMLElement) {
  const root: ShadowRoot | HTMLElement = elLockup.shadowRoot ?? elLockup;
  for (const elYtImage of root.querySelectorAll<HTMLElement>("yt-image")) {
    const elImg = elYtImage.shadowRoot?.querySelector<HTMLImageElement>("img")
      ?? elYtImage.querySelector<HTMLImageElement>("img");
    if (elImg) {
      return elImg;
    }
  }
  return root.querySelector<HTMLImageElement>("yt-thumbnail-view-model img");
}

export function applyProgressBarUpdate({ elLockup, percent }: {
  elLockup: HTMLElement;
  percent: number | null;
}) {
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
  const response = await fetch(url.split("?")[0]);
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

async function areThumbnailsDifferent({ currentSrc, newSrc }: {
  currentSrc: string;
  newSrc: string;
}) {
  if (currentSrc.split("?")[0] === newSrc.split("?")[0]) {
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
export async function prepareThumbnailDissolve({ elItem, elImg, newUrl }: {
  elItem: HTMLElement;
  elImg: HTMLImageElement;
  newUrl: string;
}) {
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
