import type { Prettify } from "../../types/prettify";
import { isInViewport } from "../animations";
import { GRID_ITEM_SELECTOR, type RichItemElement } from "../mirror/mirror-constants";
import { thumbnailUrlFromContent } from "../rich-item";
import { findThumbnailImgInItem } from "./thumbnail-locate";
import { crossfadeThumbnail } from "./thumbnail-swap";

// A creator's A/B-tested thumbnails share one feed URL; YouTube swaps which variant that URL serves
// without changing the URL string, so the URL diff never fires and the painted <img> keeps the old
// variant until a reload. This watch re-fetches each visible thumbnail's own URL, hashes the bytes,
// and dissolves in the fresh variant whenever the served picture changed. Hashes are keyed by URL,
// not video id: one video can appear in two bands at once (inline Latest plus a shelf) with two
// differently-sized thumbnail URLs, and a video-id key would make those tiles overwrite each other's
// hash every tick and dissolve forever on a picture that never changed. The fetch rides the
// browser's own image cache (the thumbnail is `max-age=300`): within that window it is a free cache
// hit, and once it lapses YouTube naturally serves its current variant and the byte hash diverges.
// The painted <img> already holds that exact URL, so the fresh variant is dissolved from the bytes
// just fetched (a one-shot object URL) rather than re-requesting the same URL, which would not reload.
// The <img> is then repointed back at its cached URL so it never lingers on the revoked blob.

export const THUMBNAIL_WATCH_INTERVAL_MS = 60 * 1000;

async function fetchThumbnailBytes(url: string, isForcedReload = false) {
  const cache = isForcedReload ? "reload" : "default";
  const response = await fetch(url, { cache }).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  return response.arrayBuffer().catch(() => null);
}

async function hashBytes(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer).catch(() => null);
  if (!digest) {
    return null;
  }

  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

type SwapToBytesParams = Prettify<{
  elImg: HTMLImageElement;
  buffer: ArrayBuffer;
  url: string;
}>;

async function swapToBytes({ elImg, buffer, url }: SwapToBytesParams) {
  const objectUrl = URL.createObjectURL(new Blob([buffer]));
  await crossfadeThumbnail({
    elImg,
    src: objectUrl
  });
  // The crossfade revealed the fresh bytes from a one-shot blob; repoint the <img> at its own cached
  // URL - the fetch above stored these exact bytes in the browser image cache - so a later lazy
  // re-decode or memory eviction reloads a valid picture. Left on the revoked blob it would reload to
  // nothing, blanking the tile until the next poll healed it and flickering it back and forth.
  elImg.src = url;
  await elImg.decode().catch(() => undefined);
  URL.revokeObjectURL(objectUrl);
}

// A changed path is certainly a new picture; a re-signed query on the same path may still serve the
// same one, so the bytes decide. An expired/unfetchable previous URL counts as changed - crossfading
// into an identical picture is visually a no-op, while skipping a real swap leaves the tile stale.
// Both fetches warm the browser cache, so the crossfade decodes instantly. Returns whether the fresh
// picture was crossfaded in.
type CrossfadeChangedThumbnailParams = Prettify<{
  elImg: HTMLImageElement;
  previousUrl: string;
  freshUrl: string;
  isSamePathRotation: boolean;
}>;

export async function crossfadeChangedThumbnail({
  elImg,
  previousUrl,
  freshUrl,
  isSamePathRotation
}: CrossfadeChangedThumbnailParams) {
  if (!isSamePathRotation) {
    await crossfadeThumbnail({
      elImg,
      src: freshUrl
    });
    return true;
  }

  const [previousBuffer, freshBuffer] = await Promise.all([
    fetchThumbnailBytes(previousUrl),
    fetchThumbnailBytes(freshUrl)
  ]);
  if (!freshBuffer) {
    return false;
  }

  const previousHash = previousBuffer && await hashBytes(previousBuffer);
  const freshHash = await hashBytes(freshBuffer);
  const isSamePicture = !!previousHash && !!freshHash && previousHash === freshHash;
  if (isSamePicture) {
    return false;
  }

  await crossfadeThumbnail({
    elImg,
    src: freshUrl
  });
  return true;
}

interface VisibleThumbnail {
  elImg: HTMLImageElement;
  url: string;
}

function collectVisibleThumbnails() {
  const visible: VisibleThumbnail[] = [];
  for (const elItem of document.querySelectorAll<RichItemElement>(GRID_ITEM_SELECTOR)) {
    if (!isInViewport(elItem)) {
      continue;
    }

    const elImg = findThumbnailImgInItem(elItem);
    const url = elItem.data.content ? thumbnailUrlFromContent(elItem.data.content) : "";
    if (elImg && url) {
      visible.push({
        elImg,
        url
      });
    }
  }
  return visible;
}

// A just-uploaded video serves a tiny placeholder at its hq720 URL until processing finishes, then the
// real picture under the same URL. The painted <img> keeps the stale placeholder decode - an <img> never
// refetches itself and the path-keyed diff treats the URL as unchanged - so it renders far smaller than
// its tile. That upscaling is the signal to force a fresh fetch past the cache and swap the real picture
// in once it has grown.
const PLACEHOLDER_UPSCALE_FACTOR = 2;

function isPlaceholderThumbnail(elImg: HTMLImageElement) {
  return elImg.naturalWidth > 0 && elImg.naturalWidth * PLACEHOLDER_UPSCALE_FACTOR < elImg.clientWidth;
}

async function decodedWidth(buffer: ArrayBuffer) {
  const bitmap = await createImageBitmap(new Blob([buffer])).catch(() => null);
  if (!bitmap) {
    return 0;
  }

  const { width } = bitmap;
  bitmap.close();
  return width;
}

async function healPlaceholderThumbnail({ elImg, url }: VisibleThumbnail) {
  const buffer = await fetchThumbnailBytes(url, true);
  if (!buffer || await decodedWidth(buffer) <= elImg.naturalWidth) {
    return;
  }

  await swapToBytes({
    elImg,
    buffer,
    url
  }).catch(() => {});
}

type ReconcileVisibleThumbnailsParams = Prettify<{
  contentHashes: Map<string, string>;
}>;

export async function reconcileVisibleThumbnails({ contentHashes }: ReconcileVisibleThumbnailsParams) {
  for (const visible of collectVisibleThumbnails()) {
    if (isPlaceholderThumbnail(visible.elImg)) {
      await healPlaceholderThumbnail(visible);
      continue;
    }

    const { elImg, url } = visible;
    const buffer = await fetchThumbnailBytes(url);
    const hash = buffer && await hashBytes(buffer);
    if (!buffer || !hash) {
      continue;
    }

    const previousHash = contentHashes.get(url);
    contentHashes.set(url, hash);
    const isServedVariantChanged = previousHash !== undefined && previousHash !== hash;
    if (isServedVariantChanged) {
      swapToBytes({
        elImg,
        buffer,
        url
      }).catch(() => {});
    }
  }
}
