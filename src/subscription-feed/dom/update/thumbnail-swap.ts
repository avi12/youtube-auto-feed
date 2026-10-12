import { isAnimationsEnabled } from "../../settings-state";
import type { Prettify } from "../../types/prettify";
import { healedThumbnailUrl } from "./thumbnail-heal";

// Swapping a refreshed thumbnail picture in place. YouTube serves the replacement either under a new
// /vi/ path (a resolution upgrade or an edited custom thumbnail) or, for an A/B variant, under the
// unchanged URL. Either way the fresh picture is crossfaded in with a per-tile overlay so the change
// reads as a deliberate transition rather than a hard cut.

async function preloadImage(url: string) {
  const elPreloader = new Image();
  elPreloader.src = url;
  return elPreloader.decode().then(() => true).catch(() => false);
}

// The overlay holding the outgoing picture; it removes itself once faded out.
function createFader(outgoingBackgroundImage: string) {
  const elFader = document.createElement("div");
  elFader.className = "ytaf-thumbnail-fader";
  elFader.style.backgroundImage = outgoingBackgroundImage;
  elFader.addEventListener("animationend", () => elFader.remove(), { once: true });
  return elFader;
}

// Crossfade the fresh picture in with a per-tile overlay rather than a document-level View Transition:
// only one View Transition runs document-wide, so several thumbnails changing in one pass would abort
// each other and hard-cut. The overlay holds the outgoing picture and fades out to reveal the fresh
// picture beneath, so every changed thumbnail crossfades independently. Decoding is awaited so a caller
// holding one-shot bytes can free them. Animations off (or no host/outgoing) falls back to an instant
// swap, preloaded first so the repaint lands already decoded and never flashes blank.
//
// The incoming picture is decoded on a detached image before the live <img> is touched. If it fails to
// decode the swap is abandoned with the tile still showing its current picture: painting an
// undecodable src would leave the tile blank after the fader lifts, and since nothing heals it the
// blank would persist. Returns whether the fresh picture was actually painted so the caller can leave
// the model on the old thumbnail and retry on the next poll.
type CrossfadeThumbnailParams = Prettify<{
  elImg: HTMLImageElement;
  src: string;
}>;

export async function crossfadeThumbnail({ elImg, src: requestedSrc }: CrossfadeThumbnailParams) {
  const src = healedThumbnailUrl(requestedSrc);
  const elHost = elImg.parentElement;
  const outgoingSrc = elImg.currentSrc || elImg.src;
  const isDecodable = await preloadImage(src);
  if (!isDecodable) {
    return false;
  }

  if (!isAnimationsEnabled() || !elHost || !outgoingSrc) {
    elImg.src = src;
    await elImg.decode().catch(() => undefined);
    return true;
  }

  elHost.append(createFader(`url("${outgoingSrc}")`));
  elImg.src = src;
  await elImg.decode().catch(() => undefined);
  return true;
}

export function isTileHovered(elItem: HTMLElement) {
  return elItem.matches(":hover");
}

// The player paints its own pictures (the poster before playback, the end-screen suggestions) as CSS
// backgrounds rather than <img>s. Same crossfade, with the fader placed first so the player's own
// overlays inside the picture (a duration stamp) stay above it.
type CrossfadeBackgroundImageParams = Prettify<{
  elImage: HTMLElement;
  src: string;
}>;

export async function crossfadeBackgroundImage({ elImage, src: requestedSrc }: CrossfadeBackgroundImageParams) {
  const src = healedThumbnailUrl(requestedSrc);
  const isDecodable = await preloadImage(src);
  if (!isDecodable) {
    return false;
  }

  const outgoingBackgroundImage = elImage.style.backgroundImage;
  if (isAnimationsEnabled() && outgoingBackgroundImage) {
    elImage.prepend(createFader(outgoingBackgroundImage));
  }

  elImage.style.backgroundImage = `url("${src}")`;
  return true;
}
