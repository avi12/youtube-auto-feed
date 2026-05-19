import { isLockupViewModel, isShortsLockupViewModel, isVideoRenderer } from "../api/guards";
import { deepArray, deepRecord, deepString, isPolymerElement, isRecord, videoIdFromData } from "../helpers";

const FETCH_CHUNK_SIZE = 8192;
const THUMBNAIL_FADE_DURATION_MS = 250;
import type {
  InnerTubeVideoRenderer,
  LockupViewModel,
  PolymerElement,
  ShortsLockupViewModel,
  VideoSnapshot
} from "../types";
import { isInViewport } from "./animations";
import { scheduleLazyUpdate } from "./lazy-update";
import { findItemElement } from "./query";
import { videoIdFromRichItem } from "./rich-item";

function replaceTextInShadowDom({ root, oldText, newText }: { root: ShadowRoot | Element; oldText: string; newText: string }) {
  if (!oldText) {
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node !== null) {
    if (node.nodeValue === oldText) {
      node.nodeValue = newText;
    }

    node = walker.nextNode();
  }
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) {
      replaceTextInShadowDom({ root: el.shadowRoot, oldText, newText });
    }
  }
}

function findThumbnailImg(elLockup: HTMLElement) {
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

function findThumbnailImgInItem(elItem: HTMLElement) {
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

function updateGridModelVideoRendererThumbnail({ videoId, thumbnail }: { videoId: string; thumbnail: InnerTubeVideoRenderer["thumbnail"] }) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const contents = deepArray(elGrid.data, "contents");
  const iItem = contents.findIndex(item => videoIdFromRichItem(item) === videoId);
  if (iItem >= 0) {
    elGrid.set(`data.contents.${iItem}.richItemRenderer.content.videoRenderer.thumbnail`, thumbnail);
  }
}

async function fetchImageBase64(url: string) {
  const response = await fetch(url.split("?")[0]);
  if (!response.ok) return null;
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = FETCH_CHUNK_SIZE;
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function videoIdFromThumbnailUrl(url: string) {
  return /\/vi(?:_webp)?\/([^/]+)\//.exec(url)?.[1] ?? null;
}

async function areThumbnailsDifferent({ currentSrc, newSrc }: { currentSrc: string; newSrc: string }) {
  if (currentSrc.split("?")[0] === newSrc.split("?")[0]) return false;
  const currentVideoId = videoIdFromThumbnailUrl(currentSrc);
  const newVideoId = videoIdFromThumbnailUrl(newSrc);
  if (currentVideoId !== null && currentVideoId === newVideoId) return false;
  try {
    const [currentBase64, newBase64] = await Promise.all([
      fetchImageBase64(currentSrc),
      fetchImageBase64(newSrc)
    ]);
    if (currentBase64 === null || newBase64 === null) return true;
    return currentBase64 !== newBase64;
  } catch {
    return true;
  }
}

function dissolveToNewThumbnail({ elImg, newUrl, afterComplete }: { elImg: HTMLImageElement; newUrl: string; afterComplete?: () => void }) {
  elImg.style.transition = `opacity ${THUMBNAIL_FADE_DURATION_MS}ms ease`;
  elImg.style.opacity = "0";
  const afterFadeOut = () => {
    const afterLoad = () => {
      elImg.style.opacity = "";
      afterComplete?.();
    };
    elImg.addEventListener("load", afterLoad, { once: true });
    elImg.addEventListener("error", afterLoad, { once: true });
    elImg.src = newUrl;
  };
  elImg.addEventListener("transitionend", afterFadeOut, { once: true });
  elImg.addEventListener("transitioncancel", afterFadeOut, { once: true });
}

function updateGridModelContentImage({ videoId, contentImage }: { videoId: string; contentImage: LockupViewModel["contentImage"] }) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const contents = deepArray(elGrid.data, "contents");
  const iItem = contents.findIndex(item => videoIdFromRichItem(item) === videoId);
  if (iItem >= 0) {
    elGrid.set(`data.contents.${iItem}.richItemRenderer.content.lockupViewModel.contentImage`, contentImage);
  }
}

function mergeLockupViewModel({ existing, incoming, forcePreserveContentImage = false }: { existing: LockupViewModel; incoming: LockupViewModel; forcePreserveContentImage?: boolean }) {
  const isSameThumbnail = forcePreserveContentImage || (
    existing.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url?.split("?")[0] ===
    incoming.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url?.split("?")[0]
  );
  const existingAvatarImage = existing.metadata?.lockupMetadataViewModel?.image;
  const incomingAvatarImage = incoming.metadata?.lockupMetadataViewModel?.image;
  const mergedLockupMeta = incoming.metadata?.lockupMetadataViewModel !== undefined || existingAvatarImage !== undefined
    ? {
      ...incoming.metadata?.lockupMetadataViewModel,
      image: incomingAvatarImage ?? existingAvatarImage
    }
    : undefined;
  const mergedContentImage = isSameThumbnail
    ? {
      ...existing.contentImage,
      thumbnailViewModel: {
        ...existing.contentImage?.thumbnailViewModel,
        image: existing.contentImage?.thumbnailViewModel?.image,
        overlays: incoming.contentImage?.thumbnailViewModel?.overlays
      }
    }
    : incoming.contentImage;
  return {
    ...incoming,
    contentImage: mergedContentImage,
    metadata: mergedLockupMeta !== undefined
      ? {
        ...incoming.metadata,
        lockupMetadataViewModel: mergedLockupMeta
      }
      : incoming.metadata
  };
}

function applyPolymerUpdate({ elItem, rawRenderer }: { elItem: PolymerElement; rawRenderer: VideoSnapshot["rawRenderer"] }) {
  const itemData = elItem.data;
  if (!isRecord(itemData)) {
    return;
  }

  const { content } = itemData;
  if (!isRecord(content)) {
    elItem.set("data", rawRenderer);
  } else if (isRecord(content.lockupViewModel)) {
    const existing = content.lockupViewModel as unknown as LockupViewModel;
    const incoming = rawRenderer as LockupViewModel;
    const merged = mergeLockupViewModel({ existing, incoming });
    const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
    if (elLockup && "lockupViewModel" in elLockup) {
      (elLockup as HTMLElement & { lockupViewModel: LockupViewModel }).lockupViewModel = merged;
    } else {
      elItem.set("data", {
        ...itemData,
        content: {
          ...content,
          lockupViewModel: merged
        }
      });
    }
  } else if (isRecord(content.shortsLockupViewModel)) {
    const elShortsLockup = elItem.querySelector<HTMLElement>("yt-shorts-lockup-view-model");
    if (elShortsLockup && "shortsLockupViewModel" in elShortsLockup) {
      (elShortsLockup as HTMLElement & {
        shortsLockupViewModel: ShortsLockupViewModel;
      }).shortsLockupViewModel = rawRenderer as ShortsLockupViewModel;
    } else {
      elItem.set("data", {
        ...itemData,
        content: {
          ...content,
          shortsLockupViewModel: rawRenderer
        }
      });
    }
  } else if (isRecord(content.videoRenderer)) {
    elItem.set("data.content.videoRenderer", rawRenderer);
  } else if (isRecord(content.gridVideoRenderer)) {
    elItem.set("data.content.gridVideoRenderer", rawRenderer);
  } else {
    const richGridMedia = deepRecord(content, "richGridMediaRenderer");
    if (richGridMedia) {
      elItem.set("data.content.richGridMediaRenderer.content.videoRenderer", rawRenderer);
    }
  }
}

function syncGridModelItem({ videoId, rawRenderer, forcePreserveContentImage = false }: { videoId: string; rawRenderer: VideoSnapshot["rawRenderer"]; forcePreserveContentImage?: boolean }) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const contents = deepArray(elGrid.data, "contents");
  const iItem = contents.findIndex(item => videoIdFromRichItem(item) === videoId);
  if (iItem < 0) {
    return;
  }

  const existingContent = deepRecord(contents[iItem], "richItemRenderer", "content");
  if (!existingContent) {
    return;
  }

  if (isRecord(existingContent.richGridMediaRenderer)) {
    elGrid.set(`data.contents.${iItem}.richItemRenderer.content.richGridMediaRenderer.content.videoRenderer`, rawRenderer);
  } else if (isLockupViewModel(rawRenderer) || isRecord(existingContent.lockupViewModel)) {
    const existingLockup = existingContent.lockupViewModel;
    const merged = isLockupViewModel(rawRenderer) && isLockupViewModel(existingLockup)
      ? mergeLockupViewModel({ existing: existingLockup, incoming: rawRenderer, forcePreserveContentImage })
      : rawRenderer;
    elGrid.set(`data.contents.${iItem}.richItemRenderer.content.lockupViewModel`, merged);
  } else if (isShortsLockupViewModel(rawRenderer) || isRecord(existingContent.shortsLockupViewModel)) {
    elGrid.set(`data.contents.${iItem}.richItemRenderer.content.shortsLockupViewModel`, rawRenderer);
  } else if (isRecord(existingContent.gridVideoRenderer)) {
    elGrid.set(`data.contents.${iItem}.richItemRenderer.content.gridVideoRenderer`, rawRenderer);
  } else {
    const existingThumbnail = forcePreserveContentImage && isRecord(existingContent.videoRenderer)
      ? existingContent.videoRenderer.thumbnail
      : undefined;
    const merged = existingThumbnail !== undefined && isVideoRenderer(rawRenderer)
      ? {
        ...rawRenderer,
        thumbnail: existingThumbnail as InnerTubeVideoRenderer["thumbnail"]
      }
      : rawRenderer;
    elGrid.set(`data.contents.${iItem}.richItemRenderer.content.videoRenderer`, merged);
  }
}

function applyTargetedGenericUpdate({ videoId, elItem, previous, fresh }: { videoId: string; elItem: PolymerElement; previous: VideoSnapshot; fresh: VideoSnapshot }) {
  if (previous.title !== fresh.title) {
    replaceTextInShadowDom({ root: elItem, oldText: previous.title, newText: fresh.title });
  }

  if (previous.viewCountText !== fresh.viewCountText) {
    replaceTextInShadowDom({ root: elItem, oldText: previous.viewCountText, newText: fresh.viewCountText });
  }

  if (previous.publishedTimeText !== fresh.publishedTimeText) {
    replaceTextInShadowDom({ root: elItem, oldText: previous.publishedTimeText, newText: fresh.publishedTimeText });
  }

  if (previous.thumbnailUrl === fresh.thumbnailUrl) {
    return;
  }

  const elImg = findThumbnailImgInItem(elItem);
  if (!elImg) {
    applyPolymerUpdate({ elItem, rawRenderer: fresh.rawRenderer });
    syncGridModelItem({ videoId, rawRenderer: fresh.rawRenderer });
    return;
  }

  void areThumbnailsDifferent({ currentSrc: elImg.src, newSrc: fresh.thumbnailUrl }).then(isDifferent => {
    if (isDifferent) {
      dissolveToNewThumbnail({ elImg, newUrl: fresh.thumbnailUrl, afterComplete: () => {
        if (isVideoRenderer(fresh.rawRenderer)) {
          updateGridModelVideoRendererThumbnail({ videoId, thumbnail: fresh.rawRenderer.thumbnail });
        }
      } });
    }
  });
}

function applyTargetedLockupUpdate({
  videoId,
  elItem,
  elLockup,
  previous,
  fresh
}: {
  videoId: string;
  elItem: PolymerElement;
  elLockup: HTMLElement;
  previous: VideoSnapshot;
  fresh: VideoSnapshot;
}) {
  const textRoot = elLockup.shadowRoot ?? elLockup;

  if (previous.title !== fresh.title) {
    replaceTextInShadowDom({ root: textRoot, oldText: previous.title, newText: fresh.title });
  }

  if (previous.viewCountText !== fresh.viewCountText) {
    replaceTextInShadowDom({ root: textRoot, oldText: previous.viewCountText, newText: fresh.viewCountText });
  }

  if (previous.publishedTimeText !== fresh.publishedTimeText) {
    replaceTextInShadowDom({ root: textRoot, oldText: previous.publishedTimeText, newText: fresh.publishedTimeText });
  }

  if (previous.thumbnailUrl === fresh.thumbnailUrl) {
    return;
  }

  const freshLockup = fresh.rawRenderer as LockupViewModel;
  const newContentImage = freshLockup.contentImage;
  const newUrl = newContentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url ?? fresh.thumbnailUrl;
  const elImg = findThumbnailImg(elLockup);
  if (!elImg) {
    applyPolymerUpdate({ elItem, rawRenderer: fresh.rawRenderer });
    syncGridModelItem({ videoId, rawRenderer: fresh.rawRenderer });
    return;
  }

  void areThumbnailsDifferent({ currentSrc: elImg.src, newSrc: newUrl }).then(isDifferent => {
    if (isDifferent) {
      dissolveToNewThumbnail({ elImg, newUrl, afterComplete: () => updateGridModelContentImage({ videoId, contentImage: newContentImage }) });
    }
  });
}

export function applyUpdate({ videoId, elItem, fresh, previous }: { videoId: string; elItem: PolymerElement; fresh: VideoSnapshot; previous?: VideoSnapshot }) {
  if (!previous || previous.status !== fresh.status || previous.isChannelLive !== fresh.isChannelLive) {
    applyPolymerUpdate({ elItem, rawRenderer: fresh.rawRenderer });
    syncGridModelItem({ videoId, rawRenderer: fresh.rawRenderer });
    return;
  }

  const itemData = elItem.data;
  if (!isRecord(itemData)) {
    applyPolymerUpdate({ elItem, rawRenderer: fresh.rawRenderer });
    syncGridModelItem({ videoId, rawRenderer: fresh.rawRenderer });
    return;
  }

  const { content } = itemData;
  if (isRecord(content) && isRecord(content.lockupViewModel)) {
    const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
    if (elLockup) {
      applyTargetedLockupUpdate({ videoId, elItem, elLockup, previous, fresh });
      return;
    }
  }

  applyTargetedGenericUpdate({ videoId, elItem, previous, fresh });
}

export function updateVideoInDom({ videoId, freshSnapshot, previousSnapshot }: { videoId: string; freshSnapshot: VideoSnapshot; previousSnapshot?: VideoSnapshot }) {
  const elItem = findItemElement(videoId);
  if (!elItem || !isPolymerElement(elItem)) {
    return;
  }

  if (isInViewport(elItem)) {
    applyUpdate({ videoId, elItem, fresh: freshSnapshot, previous: previousSnapshot });
  } else {
    scheduleLazyUpdate({ videoId, fresh: freshSnapshot, previous: previousSnapshot });
  }
}

function buildVideoElementMap() {
  const map = new Map<string, HTMLElement>();
  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }
    const videoId = videoIdFromData(elItem.data);
    if (videoId) {
      map.set(videoId, elItem);
    }
  }
  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }
    const videoId = deepString(elItem.data, "videoId");
    if (videoId) {
      map.set(videoId, elItem);
    }
  }
  return map;
}

export function batchUpdateVideosInDom({ freshSnapshots, previousSnapshotMap }: { freshSnapshots: VideoSnapshot[]; previousSnapshotMap?: Map<string, VideoSnapshot> }) {
  const elementMap = buildVideoElementMap();
  for (const fresh of freshSnapshots) {
    const elItem = elementMap.get(fresh.videoId);
    if (!elItem) {
      continue;
    }
    const previous = previousSnapshotMap?.get(fresh.videoId);
    scheduleLazyUpdate({ videoId: fresh.videoId, fresh, previous, elItemHint: elItem });
  }
}
