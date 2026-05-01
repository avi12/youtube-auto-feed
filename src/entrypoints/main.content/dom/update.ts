import type { InnerTubeVideoRenderer, LockupViewModel, PolymerElement, ShortsLockupViewModel, VideoSnapshot } from "../types";
import { deepArray, deepRecord, isPolymerElement, isRecord } from "../helpers";
import { isLockupViewModel, isShortsLockupViewModel, isVideoRenderer } from "../api/guards";
import { findItemElement } from "./query";
import { videoIdFromRichItem } from "./rich-item";
import { isElementInViewport, scheduleLazyUpdate } from "./lazy-update";

function replaceTextInShadowDom(root: ShadowRoot | Element, oldText: string, newText: string) {
  if (!oldText) return;
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
      replaceTextInShadowDom(el.shadowRoot, oldText, newText);
    }
  }
}

function findThumbnailImg(elLockup: HTMLElement) {
  const { shadowRoot } = elLockup;
  if (!shadowRoot) return null;
  for (const elYtImage of shadowRoot.querySelectorAll<HTMLElement>("yt-image")) {
    const elImg = elYtImage.shadowRoot?.querySelector<HTMLImageElement>("img")
      ?? elYtImage.querySelector<HTMLImageElement>("img");
    if (elImg) return elImg;
  }
  return null;
}

function findThumbnailImgInItem(elItem: HTMLElement): HTMLImageElement | null {
  const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
  if (elLockup) {
    const elImg = findThumbnailImg(elLockup);
    if (elImg) return elImg;
  }
  for (const elYtImage of elItem.querySelectorAll<HTMLElement>("ytd-thumbnail yt-image")) {
    const elImg = elYtImage.shadowRoot?.querySelector<HTMLImageElement>("img")
      ?? elYtImage.querySelector<HTMLImageElement>("img");
    if (elImg) return elImg;
  }
  return null;
}

function updateGridModelVideoRendererThumbnail(videoId: string, thumbnail: InnerTubeVideoRenderer["thumbnail"]) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) return;
  const contents = deepArray(elGrid.data, "contents");
  const iItem = contents.findIndex(item => videoIdFromRichItem(item) === videoId);
  if (iItem >= 0) {
    elGrid.set(`data.contents.${iItem}.richItemRenderer.content.videoRenderer.thumbnail`, thumbnail);
  }
}

function dissolveToNewThumbnail(elImg: HTMLImageElement, newUrl: string, afterComplete?: () => void) {
  elImg.style.transition = "opacity 250ms ease";
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


function updateGridModelContentImage(videoId: string, contentImage: LockupViewModel["contentImage"]) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) return;
  const contents = deepArray(elGrid.data, "contents");
  const iItem = contents.findIndex(item => videoIdFromRichItem(item) === videoId);
  if (iItem >= 0) {
    elGrid.set(`data.contents.${iItem}.richItemRenderer.content.lockupViewModel.contentImage`, contentImage);
  }
}

function mergeLockupViewModel(existing: LockupViewModel, incoming: LockupViewModel, forcePreserveContentImage = false): LockupViewModel {
  const isSameThumbnail = forcePreserveContentImage || (
    existing.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url?.split("?")[0] ===
    incoming.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url?.split("?")[0]
  );
  const existingAvatarImage = existing.metadata?.lockupMetadataViewModel?.image;
  const mergedLockupMeta = incoming.metadata?.lockupMetadataViewModel !== undefined || existingAvatarImage !== undefined
    ? { ...incoming.metadata?.lockupMetadataViewModel, image: existingAvatarImage }
    : undefined;
  return {
    ...incoming,
    contentImage: isSameThumbnail ? existing.contentImage : incoming.contentImage,
    metadata: mergedLockupMeta !== undefined
      ? { ...incoming.metadata, lockupMetadataViewModel: mergedLockupMeta }
      : incoming.metadata,
  };
}

function applyPolymerUpdate(elItem: PolymerElement, rawRenderer: VideoSnapshot["rawRenderer"]) {
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
    const merged = mergeLockupViewModel(existing, incoming);
    const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
    if (elLockup && "lockupViewModel" in elLockup) {
      (elLockup as HTMLElement & { lockupViewModel: LockupViewModel }).lockupViewModel = merged;
    } else {
      elItem.set("data", { ...itemData, content: { ...content, lockupViewModel: merged } });
    }
  } else if (isRecord(content.shortsLockupViewModel)) {
    const elShortsLockup = elItem.querySelector<HTMLElement>("yt-shorts-lockup-view-model");
    if (elShortsLockup && "shortsLockupViewModel" in elShortsLockup) {
      (elShortsLockup as HTMLElement & { shortsLockupViewModel: ShortsLockupViewModel }).shortsLockupViewModel = rawRenderer as ShortsLockupViewModel;
    } else {
      elItem.set("data", { ...itemData, content: { ...content, shortsLockupViewModel: rawRenderer } });
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

function syncGridModelItem(videoId: string, rawRenderer: VideoSnapshot["rawRenderer"], forcePreserveContentImage = false) {
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
      ? mergeLockupViewModel(existingLockup, rawRenderer, forcePreserveContentImage)
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
      ? { ...rawRenderer, thumbnail: existingThumbnail as InnerTubeVideoRenderer["thumbnail"] }
      : rawRenderer;
    elGrid.set(`data.contents.${iItem}.richItemRenderer.content.videoRenderer`, merged);
  }
}

function applyTargetedGenericUpdate(videoId: string, elItem: PolymerElement, previous: VideoSnapshot, fresh: VideoSnapshot) {
  if (previous.title !== fresh.title) {
    replaceTextInShadowDom(elItem, previous.title, fresh.title);
  }
  if (previous.viewCountText !== fresh.viewCountText) {
    replaceTextInShadowDom(elItem, previous.viewCountText, fresh.viewCountText);
  }
  if (previous.publishedTimeText !== fresh.publishedTimeText) {
    replaceTextInShadowDom(elItem, previous.publishedTimeText, fresh.publishedTimeText);
  }
  if (previous.thumbnailUrl === fresh.thumbnailUrl) {
    return;
  }
  const elImg = findThumbnailImgInItem(elItem);
  if (!elImg) {
    applyPolymerUpdate(elItem, fresh.rawRenderer);
    syncGridModelItem(videoId, fresh.rawRenderer);
    return;
  }
  syncGridModelItem(videoId, fresh.rawRenderer, true);
  dissolveToNewThumbnail(elImg, fresh.thumbnailUrl, () => {
    if (isVideoRenderer(fresh.rawRenderer)) {
      updateGridModelVideoRendererThumbnail(videoId, fresh.rawRenderer.thumbnail);
    }
  });
}

function applyTargetedLockupUpdate(
  videoId: string,
  elItem: PolymerElement,
  elLockup: HTMLElement,
  previous: VideoSnapshot,
  fresh: VideoSnapshot
) {
  const { shadowRoot } = elLockup;

  if (previous.title !== fresh.title) {
    replaceTextInShadowDom(shadowRoot, previous.title, fresh.title);
  }
  if (previous.viewCountText !== fresh.viewCountText) {
    replaceTextInShadowDom(shadowRoot, previous.viewCountText, fresh.viewCountText);
  }
  if (previous.publishedTimeText !== fresh.publishedTimeText) {
    replaceTextInShadowDom(shadowRoot, previous.publishedTimeText, fresh.publishedTimeText);
  }

  if (previous.thumbnailUrl !== fresh.thumbnailUrl) {
    const freshLockup = fresh.rawRenderer as LockupViewModel;
    const newContentImage = freshLockup.contentImage;
    const newUrl = newContentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url ?? fresh.thumbnailUrl;
    const elImg = findThumbnailImg(elLockup);
    if (elImg) {
      syncGridModelItem(videoId, fresh.rawRenderer, true);
      dissolveToNewThumbnail(elImg, newUrl, () => updateGridModelContentImage(videoId, newContentImage));
      return;
    }
    applyPolymerUpdate(elItem, fresh.rawRenderer);
    syncGridModelItem(videoId, fresh.rawRenderer);
    return;
  }

  const itemData = elItem.data;
  const isLockupUpdate =
    isRecord(itemData) &&
    isRecord(itemData.content) &&
    isLockupViewModel(itemData.content.lockupViewModel) &&
    isLockupViewModel(fresh.rawRenderer);
  if (!isLockupUpdate) {
    syncGridModelItem(videoId, fresh.rawRenderer);
  }
}

export function applyUpdate(videoId: string, elItem: PolymerElement, fresh: VideoSnapshot, previous?: VideoSnapshot) {
  if (!previous || previous.status !== fresh.status || previous.isChannelLive !== fresh.isChannelLive) {
    applyPolymerUpdate(elItem, fresh.rawRenderer);
    syncGridModelItem(videoId, fresh.rawRenderer);
    return;
  }

  const itemData = elItem.data;
  if (!isRecord(itemData)) {
    applyPolymerUpdate(elItem, fresh.rawRenderer);
    syncGridModelItem(videoId, fresh.rawRenderer);
    return;
  }

  const { content } = itemData;
  if (isRecord(content) && isRecord(content.lockupViewModel)) {
    const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
    if (elLockup?.shadowRoot) {
      applyTargetedLockupUpdate(videoId, elItem, elLockup, previous, fresh);
      return;
    }
  }

  applyTargetedGenericUpdate(videoId, elItem, previous, fresh);
}

export function updateVideoInDom(videoId: string, freshSnapshot: VideoSnapshot, previousSnapshot?: VideoSnapshot) {
  const elItem = findItemElement(videoId);
  if (!elItem || !isPolymerElement(elItem)) {
    return;
  }
  if (isElementInViewport(elItem)) {
    applyUpdate(videoId, elItem, freshSnapshot, previousSnapshot);
  } else {
    scheduleLazyUpdate(videoId, freshSnapshot, previousSnapshot);
  }
}

export function batchUpdateVideosInDom(freshSnapshots: VideoSnapshot[], previousSnapshotMap?: Map<string, VideoSnapshot>) {
  for (const fresh of freshSnapshots) {
    const elItem = findItemElement(fresh.videoId);
    if (!elItem || !isPolymerElement(elItem)) {
      continue;
    }
    const previous = previousSnapshotMap?.get(fresh.videoId);
    if (isElementInViewport(elItem)) {
      applyUpdate(fresh.videoId, elItem, fresh, previous);
    } else {
      scheduleLazyUpdate(fresh.videoId, fresh, previous);
    }
  }
}
