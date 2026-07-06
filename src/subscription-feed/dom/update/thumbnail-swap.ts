import { isAnimationsEnabled } from "../../settings-state";
import type { Prettify } from "../../types/prettify";

// Swapping a refreshed thumbnail picture in place. YouTube serves the replacement either under a new
// /vi/ path (a resolution upgrade or an edited custom thumbnail) or, for an A/B variant, under the
// unchanged URL. Either way the fresh picture is crossfaded in with a per-tile overlay so the change
// reads as a deliberate transition rather than a hard cut.

async function preloadImage(url: string) {
  const elPreloader = new Image();
  elPreloader.src = url;
  await elPreloader.decode().catch(() => undefined);
}

// Crossfade the fresh picture in with a per-tile overlay rather than a document-level View Transition:
// only one View Transition runs document-wide, so several thumbnails changing in one pass would abort
// each other and hard-cut. The overlay holds the outgoing picture and fades out to reveal the fresh
// picture beneath, so every changed thumbnail crossfades independently. Decoding is awaited so a caller
// holding one-shot bytes can free them. Animations off (or no host/outgoing) falls back to an instant
// swap, preloaded first so the repaint lands already decoded and never flashes blank.
type CrossfadeThumbnailParams = Prettify<{
  elImg: HTMLImageElement;
  src: string;
}>;

export async function crossfadeThumbnail({ elImg, src }: CrossfadeThumbnailParams) {
  const elHost = elImg.parentElement;
  const outgoingSrc = elImg.currentSrc || elImg.src;
  await preloadImage(src);

  if (!isAnimationsEnabled() || !elHost || !outgoingSrc) {
    elImg.src = src;
    await elImg.decode().catch(() => undefined);
    return;
  }

  const elFader = document.createElement("div");
  elFader.className = "ytaf-thumbnail-fader";
  elFader.style.backgroundImage = `url("${outgoingSrc}")`;
  elFader.addEventListener("animationend", () => elFader.remove(), { once: true });
  elHost.append(elFader);
  elImg.src = src;
  await elImg.decode().catch(() => undefined);
}

export function isTileHovered(elItem: HTMLElement) {
  return elItem.matches(":hover");
}
