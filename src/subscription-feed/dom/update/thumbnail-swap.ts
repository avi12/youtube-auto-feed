// Swapping a refreshed thumbnail picture in place. YouTube serves a new URL for the same video when the
// picture is replaced or offered at a higher resolution; that is the same creative refreshed, so it is
// swapped in instantly with no crossfade. Preloading first lets Polymer's repaint land already-decoded
// so it never flashes blank. A genuinely different A/B variant instead arrives under an unchanged URL
// and is crossfaded by the served-variant watch.

export async function preloadImage(url: string) {
  const elPreloader = new Image();
  elPreloader.src = url;
  await elPreloader.decode().catch(() => undefined);
}

// An in-place lockup mutation does not re-stamp the bound <img>, and the reflow repaint is keyed by
// path, so a same-path refresh (a live stream's new preview frame) needs the picture written onto the
// element directly. Preload first so the already-decoded picture lands without a blank flash.
export async function swapThumbnailInPlace(elImg: HTMLImageElement, url: string) {
  await preloadImage(url);
  elImg.src = url;
}

export function isTileHovered(elItem: HTMLElement) {
  return elItem.matches(":hover");
}
