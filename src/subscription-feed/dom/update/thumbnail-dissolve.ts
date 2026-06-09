import { isAnimationsEnabled } from "../../settings-state";
import type { Prettify } from "../../types/prettify";

// Deciding whether the picture changed and preparing the dissolve crossfade. YouTube's sqp/rs query
// params rotate on CDN re-sign independently of the image bytes - only the path is stable per picture.

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

function urlPath(url: string) {
  return url.split("?")[0];
}

export async function prepareThumbnailDissolve({ elItem, elImg, newUrl }: PrepareThumbnailDissolveParams) {
  const isHovering = elItem.matches(":hover");
  const isSamePicture = urlPath(elImg.src) === urlPath(newUrl);
  if (isHovering || isSamePicture) {
    return {
      willDissolve: false,
      newUrl
    };
  }

  await preloadImage(newUrl);

  return {
    willDissolve: !elItem.matches(":hover"),
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
