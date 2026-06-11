import { isAnimationsEnabled } from "../../settings-state";
import type { Prettify } from "../../types/prettify";
import { isInViewport } from "../animations";
import { GRID_ITEM_SELECTOR, type RichItemElement } from "../mirror/mirror-constants";
import { thumbnailUrlFromContent } from "../rich-item";
import { findThumbnailImgInItem } from "./thumbnail-locate";

const THUMBNAIL_TRANSITION_NAME = "ytaf-thumbnail-swap";

// A creator's A/B-tested thumbnails share one feed URL; YouTube swaps which variant that URL serves
// without changing the URL string, so the URL diff never fires and the painted <img> keeps the old
// variant until a reload. This watch re-fetches each visible thumbnail's own URL, hashes the bytes,
// and dissolves in the fresh variant whenever the served picture changed. The fetch rides the
// browser's own image cache (the thumbnail is `max-age=300`): within that window it is a free cache
// hit, and once it lapses YouTube naturally serves its current variant and the byte hash diverges.
// The painted <img> already holds that exact URL, so the fresh variant is dissolved from the bytes
// just fetched (a one-shot object URL) rather than re-requesting the same URL, which would not reload.

export const THUMBNAIL_WATCH_INTERVAL_MS = 60 * 1000;

async function fetchThumbnailBytes(url: string) {
  const response = await fetch(url).catch(() => null);
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

// Crossfade the new variant in with the View Transition API, naming only the <img> so the rest of
// the grid is untouched. The new bytes are decoded inside the update callback so the post-swap
// snapshot captures the new picture rather than a blank frame.
async function viewTransitionSwap(elImg: HTMLImageElement, src: string) {
  if (!isAnimationsEnabled() || !document.startViewTransition) {
    elImg.src = src;
    return;
  }

  elImg.style.viewTransitionName = THUMBNAIL_TRANSITION_NAME;
  const transition = document.startViewTransition(async () => {
    elImg.src = src;
    await elImg.decode().catch(() => undefined);
  });
  await transition.finished.catch(() => undefined);
  elImg.style.viewTransitionName = "";
}

async function swapToBytes(elImg: HTMLImageElement, buffer: ArrayBuffer) {
  const objectUrl = URL.createObjectURL(new Blob([buffer]));
  await viewTransitionSwap(elImg, objectUrl);
  URL.revokeObjectURL(objectUrl);
}

function videoIdFromAnchor(elItem: HTMLElement) {
  const href = elItem.querySelector("a#thumbnail[href], a[href*='/watch?v=']")?.getAttribute("href") ?? "";
  return href.match(/[?&]v=([\w-]{11})/)?.[1] ?? href.match(/\/shorts\/([\w-]{11})/)?.[1];
}

interface VisibleThumbnail {
  videoId: string;
  elImg: HTMLImageElement;
  url: string;
}

function collectVisibleThumbnails() {
  const visible: VisibleThumbnail[] = [];
  for (const elItem of document.querySelectorAll<RichItemElement>(GRID_ITEM_SELECTOR)) {
    if (!isInViewport(elItem)) {
      continue;
    }

    const videoId = videoIdFromAnchor(elItem);
    const elImg = findThumbnailImgInItem(elItem);
    const url = elItem.data.content ? thumbnailUrlFromContent(elItem.data.content) : "";
    if (videoId && elImg && url) {
      visible.push({
        videoId,
        elImg,
        url
      });
    }
  }
  return visible;
}

type ReconcileVisibleThumbnailsParams = Prettify<{
  contentHashes: Map<string, string>;
}>;

export async function reconcileVisibleThumbnails({ contentHashes }: ReconcileVisibleThumbnailsParams) {
  for (const { videoId, elImg, url } of collectVisibleThumbnails()) {
    const buffer = await fetchThumbnailBytes(url);
    const hash = buffer && await hashBytes(buffer);
    if (!buffer || !hash) {
      continue;
    }

    const previousHash = contentHashes.get(videoId);
    contentHashes.set(videoId, hash);
    const hasServedVariantChanged = previousHash !== undefined && previousHash !== hash;
    if (hasServedVariantChanged) {
      swapToBytes(elImg, buffer).catch(() => {});
    }
  }
}
