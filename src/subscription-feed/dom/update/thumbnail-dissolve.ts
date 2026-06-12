import { isAnimationsEnabled } from "../../settings-state";
import type { Prettify } from "../../types/prettify";

// Deciding whether to dissolve to the new thumbnail. The caller only reaches here when the snapshot
// thumbnail URL changed, which YouTube rotates only on a real picture edit - so the picture is new
// and the painted image must be repainted. The image bytes cannot confirm this: i.ytimg signed URLs
// are not version-pinned (the old URL serves the current picture once the CDN propagates), the
// painted <img> is cross-origin tainted so its displayed pixels are unreadable, and two signed
// variants of one picture are not byte-equal. So the only gate is hover - never disrupt the hover
// preview - and every other change repaints.
type PrepareThumbnailDissolveParams = Prettify<{
  elItem: HTMLElement;
  newUrl: string;
}>;

export function prepareThumbnailDissolve({ elItem, newUrl }: PrepareThumbnailDissolveParams) {
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
type DissolveThumbnailParams = Prettify<{
  elImg: HTMLImageElement;
  newUrl: string;
}>;

export async function dissolveThumbnail({ elImg, newUrl }: DissolveThumbnailParams) {
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
