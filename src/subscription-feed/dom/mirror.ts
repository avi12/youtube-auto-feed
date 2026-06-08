import { isAnimationsEnabled } from "../settings-state";
import type { InnerTubeRichGridItem } from "../types/innertube";
import type { PolymerElement } from "../types/polymer";
import type { Prettify } from "../types/prettify";
import { flushPolymerRender, isPolymerElement } from "../utils/polymer";
import { deepArray, isRecord } from "../utils/records";
import { videoIdFromData } from "../utils/video-id";
import { animateItemsOut, isInViewport } from "./animations";
import { preloadThumbnail } from "./build";
import {
  avatarUrlFromContent,
  isCollaborativeRichItem,
  thumbnailUrlFromContent,
  thumbnailUrlFromRichItem,
  videoIdFromRichItem
} from "./rich-item";

// Reconciles Edge's Latest band inline videos with the API's emission. The new data.contents is
// rebuilt each poll, but every richSectionRenderer (shelf wrapper) and continuationItemRenderer is
// passed through by reference from the previous contents - never reconstructed. That way Polymer's
// dom-repeat sees identical object identity for the shelves and won't re-render or alter their
// inner contents. Only inline video slots (root-level richItemRenderers) are mutated, and only to
// match the API's order/membership.
//
// The grid's dom-repeat is index-based: replacing data.contents rebinds each existing node to the
// item now at its index rather than moving nodes. So a front insert shifts every inline node's data
// to the previous slot's video, and each node must repaint its thumbnail. YouTube paints a grid
// tile's thumbnail once and does NOT repaint it on an in-place data change - only a fresh viewport
// intersection (a scroll) does - so a reused node keeps the previous occupant's image until we do
// what a scroll would: re-assert each tile's thumbnail src from its bound video, repeated until the
// grid stops needing corrections.

const THUMBNAIL_PRELOAD_TIMEOUT_MS = 1000;
const REBIND_MICROTASK_POLL_MAX = 20;
const REBIND_FRAME_POLL_MAX = 10;
// Re-assert thumbnails until THUMBNAIL_STABLE_FRAMES consecutive frames need no correction, capped
// at THUMBNAIL_REASSERT_FRAMES_MAX so a tile YouTube keeps fighting can't spin forever (~2s).
const THUMBNAIL_REASSERT_FRAMES_MAX = 120;
const THUMBNAIL_STABLE_FRAMES = 5;
const GRID_ITEM_SELECTOR = "ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer";
// A dropped COLLABORATIVE (multi-channel) video is kept in place until it has been absent for this many
// consecutive polls, because such videos flicker out and back in the API's noisy pagination tail.
// Non-collaborative videos are not buffered - they are removed on the first poll they are absent.
const STICKY_DELETE_POLLS = 4;
const SURVIVOR_SHIFT_MS = 380;
const REMOVAL_SETTLE_FRAMES_MAX = 12;
const REMOVAL_STABLE_FRAMES = 2;
// Tiles just below the fold slide up into view when something above them is removed; record and
// animate them too. Covers a few rows of the largest tiles so multi-item shifts still animate.
const REFLOW_MARGIN_BELOW_PX = 1200;
const absenceCountByVideoId = new Map<string, number>();

type MirrorFromApiParams = Prettify<{
  apiContents: Prettify<InnerTubeRichGridItem>[];
}>;

export async function mirrorFromApi({ apiContents }: MirrorFromApiParams) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const currentContents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents");
  if (currentContents.length === 0) {
    return;
  }

  const previousInlineIds = collectInlineVideoIds(currentContents);
  const newContents = composeNewContents({
    apiContents,
    currentContents
  });
  if (isReferenceEqualArray(currentContents, newContents)) {
    return;
  }

  // Newly-inserted videos are derived from newContents (what's actually written), not from a
  // parallel sequence. Otherwise the entrance animation, thumbnail preload, and rebind-await all
  // operate on a different set of IDs than the data write - tiles can land in the DOM without a
  // bound thumbnail or fully-attached event handlers, leaving them un-interactable until the
  // user hovers and forces Polymer to flush.
  const newlyInsertedIds = new Set<string>();
  const newThumbnailUrls = new Map<string, string>();
  for (const item of newContents) {
    const videoId = videoIdFromRichItem(item);
    if (videoId && !previousInlineIds.has(videoId)) {
      newlyInsertedIds.add(videoId);
      const url = thumbnailUrlFromRichItem(item);
      if (url) {
        newThumbnailUrls.set(videoId, url);
      }
    }
  }

  await preloadNewThumbnails(newThumbnailUrls);

  // One reflow path for every change. A view transition can't drive it: the grid detaches/rebinds
  // nodes via requestAnimationFrame, which is stalled for the whole transition, so a removal's
  // survivors never move until it ends. Instead fade any dropped tiles out, write, then FLIP every
  // survivor from its old slot to its new one - released together so they glide simultaneously
  // (Google-Meet style) rather than cascading. Reduced motion gets an instant write.
  if (!isAnimationsEnabled()) {
    elGrid.set("data.contents", newContents);
  } else {
    const elRemovedTiles = findRemovedViewportTiles(newContents);
    if (elRemovedTiles.length > 0) {
      await animateItemsOut(elRemovedTiles);
    }

    await setContentsWithFlip({
      elGrid,
      newContents,
      newlyInsertedIds
    });
  }

  repaintInsertedThumbnails(newlyInsertedIds).catch(() => {});
}

function findRemovedViewportTiles(newContents: Prettify<InnerTubeRichGridItem>[]) {
  const newInlineIds = new Set(newContents.map(videoIdFromRichItem).filter(Boolean));
  return [...document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)]
    .filter(isInViewport)
    .filter(elItem => {
      const videoId = isPolymerElement(elItem) ? videoIdFromData(elItem.data) : "";
      return !!videoId && !newInlineIds.has(videoId);
    });
}

function inlineDomVideoIds() {
  return [...document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)]
    .map(elItem => (isPolymerElement(elItem) ? videoIdFromData(elItem.data) : ""))
    .filter(Boolean)
    .join();
}

// The reflow zone is the viewport plus a margin below it, so tiles that slide up into view from
// just under the fold are recorded and animated, not just the ones already on screen.
function isInReflowZone(elItem: HTMLElement) {
  const { bottom, top } = elItem.getBoundingClientRect();
  return bottom > 0 && top < innerHeight + REFLOW_MARGIN_BELOW_PX;
}

function recordReflowZoneRects() {
  const rects = new Map<string, DOMRect>();
  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isInReflowZone(elItem) || !isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (videoId) {
      rects.set(videoId, elItem.getBoundingClientRect());
    }
  }
  return rects;
}

type PinSurvivorsParams = Prettify<{
  oldRects: Map<string, DOMRect>;
  newlyInsertedIds: Set<string>;
}>;

// Hold each survivor at the screen position it had before the write by offsetting it with the
// `translate` property. Re-run every frame while the grid settles: the mirror clones shifted items
// so Polymer re-stamps their nodes asynchronously, and re-pinning catches whatever node currently
// holds each video. The offset is measured from the untranslated rect, so it stays correct as the
// grid reflows underneath.
function pinSurvivorsToOldRects({ oldRects, newlyInsertedIds }: PinSurvivorsParams) {
  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isInReflowZone(elItem) || !isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    const isPinnable = !!videoId && !newlyInsertedIds.has(videoId) && oldRects.has(videoId);
    if (!isPinnable) {
      continue;
    }

    const oldRect = oldRects.get(videoId);
    if (!oldRect) {
      continue;
    }

    elItem.style.transition = "none";
    elItem.style.translate = "";
    const newRect = elItem.getBoundingClientRect();
    const deltaX = oldRect.left - newRect.left;
    const deltaY = oldRect.top - newRect.top;
    if (Math.abs(deltaX) >= 1 || Math.abs(deltaY) >= 1) {
      elItem.style.translate = `${deltaX}px ${deltaY}px`;
    }
  }
}

// Animate every pinned survivor from its held (old) position to its real one.
function releaseSurvivors() {
  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!elItem.style.translate) {
      elItem.style.transition = "";
      continue;
    }

    elItem.style.transition = `translate ${SURVIVOR_SHIFT_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    elItem.style.translate = "";
    elItem.addEventListener("transitionend", () => {
      elItem.style.transition = "";
      elItem.style.translate = "";
    }, { once: true });
  }
}

function animateNewEntrances(newlyInsertedIds: Set<string>) {
  if (newlyInsertedIds.size === 0) {
    return;
  }

  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (!videoId || !newlyInsertedIds.has(videoId)) {
      continue;
    }

    elItem.style.opacity = "";

    if (isInViewport(elItem)) {
      elItem.classList.add("ytaf-new");
      elItem.addEventListener("animationend", () => elItem.classList.remove("ytaf-new"), { once: true });
    }
  }
}

function hideNewInsertedTiles(newlyInsertedIds: Set<string>) {
  if (newlyInsertedIds.size === 0) {
    return;
  }

  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isInViewport(elItem) || !isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (videoId && newlyInsertedIds.has(videoId)) {
      elItem.style.opacity = "0";
    }
  }
}

// Reflow path for inserts, removals and reorders. Dropped tiles have already faded out. Snapshot
// survivor positions, write, then hold every survivor at its old position each frame until the
// grid's deferred rebind/re-stamp settles, revealing any reused node along the way; finally release
// them so they glide into place together. New tiles get the entrance animation.
async function setContentsWithFlip({ elGrid, newContents, newlyInsertedIds }: SetContentsParams) {
  if (!isPolymerElement(elGrid)) {
    return;
  }

  const newInlineIds = new Set(newContents.map(videoIdFromRichItem).filter((id): id is string => !!id));
  const expectedInlineIds = [...newInlineIds].join();

  // A node rebound to a different video has its thumbnail and avatar <img> src cleared by YouTube and
  // only repainted once the new image decodes. On Chromium that clear/reload is synchronous within
  // the write; on Firefox it is deferred, so the tile paints blank for a frame or two. This observer
  // covers the gap in the same microtask the src is cleared (ahead of paint) by mirroring the bound
  // image into a CSS background, so survivors never flash empty.
  const imageCoverObserver = observeAndCoverBlankImages(elGrid);

  // Paint each survivor's FUTURE thumbnail as a background on its stable tile node ONE FRAME before
  // the write. On Firefox the rebind defers clearing the <img> and, for some tiles, replaces the
  // whole lockup subtree - so an img-level cover applied during the write either paints too late or
  // is discarded with the replaced element, and the tile flashes empty just before it slides. The
  // tile node (ytd-rich-item-renderer) is never replaced, and a background set a frame early has
  // already rasterised by the time the <img> blanks, so the future thumbnail holds with no gap.
  await new Promise<void>(resolve =>
    requestAnimationFrame(() => {
      preCoverReflowImages(newContents, newlyInsertedIds);
      resolve();
    }));

  // Write and first pin inside a single rAF so the DOM mutation and the survivor pins are
  // guaranteed to land before the same frame's layout+paint. Polymer.flush() does not
  // synchronously reposition dom-repeat nodes, so a synchronous pin outside a rAF computes
  // delta=0 and leaves survivors un-pinned for the paint that follows animationend (which
  // fires after the rAF phase).
  const oldRects = await new Promise<Map<string, DOMRect>>(resolve =>
    requestAnimationFrame(() => {
      const rects = recordReflowZoneRects();
      elGrid.set("data.contents", newContents);
      flushPolymerRender();
      revealReboundSurvivors(newInlineIds);
      hideNewInsertedTiles(newlyInsertedIds);
      // Correct thumbnails before pinSurvivorsToOldRects so that if the browser
      // delivers a compositor frame mid-loop (during getBoundingClientRect calls),
      // it shows corrected thumbnails rather than the blank state Polymer left behind.
      repaintInlineThumbnails();
      coverBlankImages();
      pinSurvivorsToOldRects({
        oldRects: rects,
        newlyInsertedIds
      });
      resolve(rects);
    }));

  const pinParams = {
    oldRects,
    newlyInsertedIds
  };
  let stableFrames = inlineDomVideoIds() === expectedInlineIds ? 1 : 0;
  for (let i = 0; i < REMOVAL_SETTLE_FRAMES_MAX - 1 && stableFrames < REMOVAL_STABLE_FRAMES; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => {
      revealReboundSurvivors(newInlineIds);
      hideNewInsertedTiles(newlyInsertedIds);
      repaintInlineThumbnails();
      coverBlankImages();
      pinSurvivorsToOldRects(pinParams);
      resolve();
    }));
    stableFrames = inlineDomVideoIds() === expectedInlineIds ? stableFrames + 1 : 0;
  }

  releaseSurvivors();
  repaintInlineThumbnails();
  coverBlankImages();
  animateNewEntrances(newlyInsertedIds);

  // Keep the cover observer live through the slide: the release-time repaint above, or a late
  // re-stamp by YouTube, can blank a tile after the settle loop, which would otherwise paint empty
  // just as the videos start sliding. The per-tile load handler drops each cover as its image lands.
  for (let i = 0; i < Math.ceil(SURVIVOR_SHIFT_MS / 16) + 2; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  imageCoverObserver?.disconnect();
  clearReflowImageCovers();
}

// Paint each reflow-zone survivor's FUTURE images one frame before the write as shaped overlays on the
// STABLE tile node (ytd-rich-item-renderer, which YouTube never replaces - unlike the thumbnail and
// avatar containers, which it swaps wholesale on ~1 in 3 tiles). Each overlay sits BEHIND the real
// <img> (z-index -1), so it only shows while a rebound image is blank and never paints the upcoming
// picture over the tile's current content. The thumbnail overlay carries the thumbnail's own
// border-radius (rounded corners); the avatar overlay is a circle. The i-th ytd-rich-item-renderer
// binds to the i-th new rich item, so DOM order maps onto content order. New tiles are skipped.
function preCoverReflowImages(newContents: Prettify<InnerTubeRichGridItem>[], newlyInsertedIds: Set<string>) {
  const futureItems = newContents.filter(item => !!item.richItemRenderer);
  const elItems = [...document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)];
  for (let i = 0; i < elItems.length && i < futureItems.length; i++) {
    const elItem = elItems[i];
    const futureContent = futureItems[i].richItemRenderer?.content;
    if (!isInReflowZone(elItem) || !futureContent) {
      continue;
    }

    const futureId = videoIdFromRichItem(futureItems[i]);
    if (futureId && newlyInsertedIds.has(futureId)) {
      continue;
    }

    const elThumb = thumbnailContainerInItem(elItem);
    const elAvatar = avatarImgInItem(elItem);
    const thumbUrl = thumbnailUrlFromContent(futureContent);
    const avatarUrl = avatarUrlFromContent(futureContent);
    if ((!elThumb || !thumbUrl) && (!elAvatar || !avatarUrl)) {
      continue;
    }

    prepareCoverHost(elItem);
    const tileRect = elItem.getBoundingClientRect();
    if (elThumb && thumbUrl) {
      const thumbRadius = getComputedStyle(elThumb).borderRadius;
      addCoverOverlay(elItem, thumbUrl, elThumb.getBoundingClientRect(), tileRect, thumbRadius);
    }

    if (elAvatar && avatarUrl) {
      addCoverOverlay(elItem, avatarUrl, elAvatar.getBoundingClientRect(), tileRect, "50%");
    }
  }
}

// Make the tile node a positioned, isolated stacking context so a z-index:-1 child stays behind the
// tile's own content yet never slips behind neighbouring tiles.
function prepareCoverHost(elItem: HTMLElement) {
  if (getComputedStyle(elItem).position === "static") {
    elItem.style.position = "relative";
  }

  elItem.style.isolation = "isolate";
  elItem.dataset.ytafCoverHost = "1";
}

function addCoverOverlay(elItem: HTMLElement, url: string, rect: DOMRect, tileRect: DOMRect, radius: string) {
  if (rect.width === 0) {
    return;
  }

  const elOverlay = document.createElement("div");
  elOverlay.dataset.ytafCoverOverlay = "1";
  const { style } = elOverlay;
  style.position = "absolute";
  style.left = `${rect.left - tileRect.left}px`;
  style.top = `${rect.top - tileRect.top}px`;
  style.width = `${rect.width}px`;
  style.height = `${rect.height}px`;
  style.borderRadius = radius;
  style.backgroundImage = `url("${url}")`;
  style.backgroundSize = "cover";
  style.backgroundPosition = "center";
  style.zIndex = "-1";
  style.pointerEvents = "none";
  elItem.append(elOverlay);
}

function clearReflowImageCovers() {
  for (const elOverlay of document.querySelectorAll("[data-ytaf-cover-overlay]")) {
    elOverlay.remove();
  }

  for (const elItem of document.querySelectorAll<HTMLElement>("[data-ytaf-cover-host]")) {
    elItem.style.position = "";
    elItem.style.isolation = "";
    delete elItem.dataset.ytafCoverHost;
  }
}

function thumbnailContainerInItem(elItem: HTMLElement) {
  const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
  const root: HTMLElement | ShadowRoot = elLockup?.shadowRoot ?? elLockup ?? elItem;
  return root.querySelector<HTMLElement>("yt-thumbnail-view-model, ytd-thumbnail");
}

// Mirror each rebound tile's bound images into a CSS background while their foreground <img> is empty
// or still decoding, so the tile never paints blank during the reload. The cached background paints
// immediately (the image was just on screen at the neighbour slot) and is dropped the moment the
// foreground image finishes loading, leaving the real <img> in place. Both the video thumbnail and
// the channel avatar rebind - and so blank - when the node shifts to a different video.
function coverBlankImages() {
  for (const elItem of document.querySelectorAll<RichItemElement>(GRID_ITEM_SELECTOR)) {
    if (!isInReflowZone(elItem) || !isPolymerElement(elItem)) {
      continue;
    }

    const { content } = elItem.data;
    const thumbUrl = thumbnailUrlFromContent(content);
    for (const elImg of thumbnailImgsInItem(elItem)) {
      coverImgWhileBlank(elImg, thumbUrl);
    }

    coverImgWhileBlank(avatarImgInItem(elItem), avatarUrlFromContent(content));
  }
}

function coverImgWhileBlank(elImg: HTMLImageElement | null, url: string) {
  if (!elImg || !url) {
    return;
  }

  const isImageReady = elImg.complete && elImg.naturalWidth > 0;
  if (isImageReady || elImg.style.backgroundImage) {
    return;
  }

  elImg.style.backgroundImage = `url("${url}")`;
  elImg.style.backgroundSize = "cover";
  elImg.style.backgroundPosition = "center";
  elImg.addEventListener("load", () => {
    elImg.style.backgroundImage = "";
    elImg.style.backgroundSize = "";
    elImg.style.backgroundPosition = "";
  }, { once: true });
}

function observeAndCoverBlankImages(elGrid: HTMLElement) {
  const elContents = elGrid.querySelector("#contents");
  if (!elContents) {
    return null;
  }

  const observer = new MutationObserver(() => {
    repaintInlineThumbnails();
    coverBlankImages();
  });
  const observeConfig = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src"]
  };
  observer.observe(elContents, observeConfig);

  // Avatars live inside each lockup's shadow root, which a #contents subtree observer can't reach;
  // observe those roots too so an avatar src-clear is re-covered in the same microtask, ahead of
  // paint, with the same robustness as a light-DOM thumbnail clear.
  for (const elLockup of elContents.querySelectorAll("yt-lockup-view-model")) {
    if (elLockup.shadowRoot) {
      observer.observe(elLockup.shadowRoot, observeConfig);
    }
  }
  return observer;
}

function revealReboundSurvivors(newInlineIds: Set<string>) {
  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    const videoId = isPolymerElement(elItem) ? videoIdFromData(elItem.data) : "";
    if (videoId && newInlineIds.has(videoId)) {
      elItem.classList.remove("ytaf-removing");
    }
  }
}

type SetContentsParams = Prettify<{
  elGrid: HTMLElement;
  newContents: Prettify<InnerTubeRichGridItem>[];
  newlyInsertedIds: Set<string>;
}>;

function preloadNewThumbnails(newThumbnailUrls: Map<string, string>) {
  const urls = [...newThumbnailUrls.values()];
  if (urls.length === 0) {
    return Promise.resolve();
  }

  const allLoaded = Promise.all(urls.map(preloadThumbnail));
  const deadline = new Promise<void>(resolve => setTimeout(resolve, THUMBNAIL_PRELOAD_TIMEOUT_MS));
  return Promise.race([allLoaded, deadline]);
}

async function repaintInsertedThumbnails(newlyInsertedIds: Set<string>) {
  // Polymer debounces the dom-repeat rebind across microtasks/frames. Wait until the newly inserted
  // tiles exist before repainting, otherwise the first passes run against a half-rendered grid.
  for (let i = 0; i < REBIND_MICROTASK_POLL_MAX && !areInsertedTilesPresent(newlyInsertedIds); i++) {
    await Promise.resolve();
  }
  for (let i = 0; i < REBIND_FRAME_POLL_MAX && !areInsertedTilesPresent(newlyInsertedIds); i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }

  // Re-assert each tile's thumbnail from its bound video until the grid is stable (or we hit the
  // cap). The model's preferred source URL is exactly what YouTube paints and stays byte-stable per
  // picture (sqp/rs only rotate when the image itself changes), so a full-URL compare repaints both
  // a rebound tile (different video) and a same-id thumbnail the creator swapped, without churning.
  let stableFrames = 0;
  for (let i = 0; i < THUMBNAIL_REASSERT_FRAMES_MAX && stableFrames < THUMBNAIL_STABLE_FRAMES; i++) {
    const correctedCount = repaintInlineThumbnails();
    stableFrames = correctedCount === 0 ? stableFrames + 1 : 0;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}

function areInsertedTilesPresent(newlyInsertedIds: Set<string>) {
  return findNewlyInsertedElements(newlyInsertedIds).length === newlyInsertedIds.size;
}

type RichItemElement = PolymerElement<NonNullable<InnerTubeRichGridItem["richItemRenderer"]>>;

function repaintInlineThumbnails() {
  let correctedCount = 0;
  for (const elItem of document.querySelectorAll<RichItemElement>(GRID_ITEM_SELECTOR)) {
    const { content } = elItem.data;

    const thumbUrl = thumbnailUrlFromContent(content);
    if (thumbUrl) {
      const thumbPath = thumbUrl.split("?")[0];
      for (const elImg of thumbnailImgsInItem(elItem)) {
        if (elImg.src.split("?")[0] !== thumbPath) {
          elImg.src = thumbUrl;
          correctedCount++;
        }
      }
    }

    const avatarUrl = avatarUrlFromContent(content);
    if (avatarUrl) {
      const elAvatarImg = avatarImgInItem(elItem);
      if (elAvatarImg && elAvatarImg.src.split("?")[0] !== avatarUrl.split("?")[0]) {
        elAvatarImg.src = avatarUrl;
        correctedCount++;
      }
    }
  }
  return correctedCount;
}

function avatarImgInItem(elItem: HTMLElement) {
  const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
  const root: HTMLElement | ShadowRoot = elLockup?.shadowRoot ?? elLockup ?? elItem;
  return root.querySelector<HTMLImageElement>("yt-decorated-avatar-view-model img");
}

// Every thumbnail <img> in a tile, across the lockup shadow root and each thumbnail container's own
// shadow tree. Scoped to the thumbnail containers (yt-thumbnail-view-model for lockups, ytd-thumbnail
// for legacy renderers) so the channel avatar - which lives outside them - is never repainted with a
// video thumbnail URL. Returning every match makes the repaint robust to whichever element YouTube
// actually paints in a given layout, instead of guessing a single one.
function thumbnailImgsInItem(elItem: HTMLElement) {
  const elImgs: HTMLImageElement[] = [];
  const searchRoots: (HTMLElement | ShadowRoot)[] = [elItem];
  const elLockup = elItem.querySelector("yt-lockup-view-model");
  if (elLockup?.shadowRoot) {
    searchRoots.push(elLockup.shadowRoot);
  }

  for (const searchRoot of searchRoots) {
    for (const elContainer of searchRoot.querySelectorAll<HTMLElement>("yt-thumbnail-view-model, ytd-thumbnail")) {
      const containerRoot: HTMLElement | ShadowRoot = elContainer.shadowRoot ?? elContainer;
      for (const elImg of containerRoot.querySelectorAll<HTMLImageElement>("img")) {
        elImgs.push(elImg);
      }
      for (const elYtImage of containerRoot.querySelectorAll<HTMLElement>("yt-image")) {
        const elImg = elYtImage.shadowRoot?.querySelector<HTMLImageElement>("img");
        if (elImg) {
          elImgs.push(elImg);
        }
      }
    }
  }
  return elImgs;
}

function collectInlineVideoIds(contents: Prettify<InnerTubeRichGridItem>[]) {
  const ids = new Set<string>();
  for (const item of contents) {
    const videoId = videoIdFromRichItem(item);
    if (videoId) {
      ids.add(videoId);
    }
  }
  return ids;
}

type InlineBandEntry = {
  videoId: string;
  item: Prettify<InnerTubeRichGridItem>;
};

type ComposeNewContentsParams = Prettify<{
  apiContents: Prettify<InnerTubeRichGridItem>[];
  currentContents: Prettify<InnerTubeRichGridItem>[];
}>;

// Reconcile the grid's Latest band (every top-level inline video, unioned across the runs that the
// section markers split it into) to the API's emission with a sequence diff. The longest common
// subsequence of the two id sequences is kept in place; around it, videos the API added are inserted
// at their API position (so a newly-subscribed channel's upload lands at its correct spot, not just
// the front), videos that merely reordered follow the API, and videos the API dropped are retained
// until they have been absent for STICKY_DELETE_POLLS consecutive polls - so the API's noisy
// pagination tail can't flicker tiles in and out. The merged band is then re-flowed into the grid's
// run structure: section markers and the continuation pass through by reference at their positions,
// middle runs keep their length so each marker stays at its row, and the last run absorbs the net
// size change.
function composeNewContents({ apiContents, currentContents }: ComposeNewContentsParams) {
  const currentRuns = findAllInlineRuns(currentContents);
  if (currentRuns.length === 0) {
    return currentContents;
  }

  const currentBand = extractInlineBand(currentContents);
  const currentBandIds = new Set(currentBand.map(entry => entry.videoId));

  // Exclude any API video that lives only inside a grid shelf (Most relevant / Shorts): pulling it
  // into the Latest band would render the same video twice.
  const gridVideoIds = collectAllGridVideoIds(currentContents);
  const apiBand = extractInlineBand(apiContents).filter(
    entry => currentBandIds.has(entry.videoId) || !gridVideoIds.has(entry.videoId)
  );
  const apiBandIds = new Set(apiBand.map(entry => entry.videoId));
  const apiItemById = new Map(apiBand.map(entry => [entry.videoId, entry.item]));

  const collaborativeIds = new Set(
    currentBand.filter(entry => isCollaborativeRichItem(entry.item)).map(entry => entry.videoId)
  );
  const retainedDroppedIds = updateAbsenceCountsAndRetain({
    currentBandIds,
    apiBandIds,
    collaborativeIds
  });

  const lcs = longestCommonSubsequence(
    currentBand.map(entry => entry.videoId),
    apiBand.map(entry => entry.videoId)
  );
  const targetBand = mergeBand({
    currentBand,
    apiBand,
    lcs,
    apiBandIds,
    apiItemById,
    retainedDroppedIds
  });

  const isUnchanged = targetBand.length === currentBand.length
    && targetBand.every((item, i) => videoIdFromRichItem(item) === currentBand[i].videoId);
  if (isUnchanged) {
    return currentContents;
  }

  return reflowBandIntoRuns({
    currentContents,
    currentRuns,
    targetBand
  });
}

function extractInlineBand(contents: Prettify<InnerTubeRichGridItem>[]) {
  const band: InlineBandEntry[] = [];
  for (const run of findAllInlineRuns(contents)) {
    for (let i = run.start; i < run.end; i++) {
      const item = contents[i];
      const videoId = videoIdFromRichItem(item);
      if (videoId) {
        band.push({
          videoId,
          item
        });
      }
    }
  }
  return band;
}

type UpdateAbsenceCountsParams = Prettify<{
  currentBandIds: Set<string>;
  apiBandIds: Set<string>;
  collaborativeIds: Set<string>;
}>;

function updateAbsenceCountsAndRetain({ currentBandIds, apiBandIds, collaborativeIds }: UpdateAbsenceCountsParams) {
  const retainedDroppedIds = new Set<string>();
  for (const videoId of currentBandIds) {
    if (apiBandIds.has(videoId)) {
      absenceCountByVideoId.delete(videoId);
      continue;
    }

    const absenceCount = (absenceCountByVideoId.get(videoId) ?? 0) + 1;
    absenceCountByVideoId.set(videoId, absenceCount);

    // Only collaborative videos get the sticky buffer; a non-collaborative video absent from the API
    // is dropped immediately (threshold 0, so its first absent poll already exceeds it).
    const stickyThreshold = collaborativeIds.has(videoId) ? STICKY_DELETE_POLLS : 0;
    if (absenceCount <= stickyThreshold) {
      retainedDroppedIds.add(videoId);
    }
  }

  // Forget counters for videos that have left the band entirely so a later reappearance starts fresh.
  for (const videoId of absenceCountByVideoId.keys()) {
    if (!currentBandIds.has(videoId)) {
      absenceCountByVideoId.delete(videoId);
    }
  }
  return retainedDroppedIds;
}

type MergeBandParams = Prettify<{
  currentBand: InlineBandEntry[];
  apiBand: InlineBandEntry[];
  lcs: string[];
  apiBandIds: Set<string>;
  apiItemById: Map<string, Prettify<InnerTubeRichGridItem>>;
  retainedDroppedIds: Set<string>;
}>;

// Walk both bands against their longest common subsequence. Between two shared anchors: drop-but-
// retained videos (gone from the API, still within the sticky window) keep their slot, then API-side
// videos (new or reordered) fill in. Each video already present in the band keeps its LIVE current
// item reference; only genuinely new videos use the API item. Preserving identity lets Polymer's
// index-based dom-repeat reuse the existing node for any video whose index is unchanged - so its
// thumbnail is never reloaded and the band doesn't flash. reflowBandIntoRuns then clones exactly the
// items whose final index differs from their original, which is what prevents the path-effect bleed
// (a moved object linking its slot to a neighbor's contentImage); items that never change slot stay
// untouched and so can't bleed.
function mergeBand({
  currentBand,
  apiBand,
  lcs,
  apiBandIds,
  apiItemById,
  retainedDroppedIds
}: MergeBandParams) {
  const currentItemById = new Map(currentBand.map(entry => [entry.videoId, entry.item]));
  const target: Prettify<InnerTubeRichGridItem>[] = [];
  let currentIndex = 0;
  let apiIndex = 0;

  function itemFor(videoId: string) {
    return currentItemById.get(videoId) ?? apiItemById.get(videoId);
  }

  function drainCurrentUntil(anchor: string | null) {
    while (currentIndex < currentBand.length && currentBand[currentIndex].videoId !== anchor) {
      const { videoId, item } = currentBand[currentIndex];
      const isDroppedAndRetained = !apiBandIds.has(videoId) && retainedDroppedIds.has(videoId);
      if (isDroppedAndRetained) {
        target.push(item);
      }

      currentIndex++;
    }
  }

  function drainApiUntil(anchor: string | null) {
    while (apiIndex < apiBand.length && apiBand[apiIndex].videoId !== anchor) {
      const { videoId, item } = apiBand[apiIndex];
      target.push(itemFor(videoId) ?? item);
      apiIndex++;
    }
  }

  for (const anchor of lcs) {
    drainCurrentUntil(anchor);
    drainApiUntil(anchor);
    const anchorItem = itemFor(anchor);
    if (anchorItem) {
      target.push(anchorItem);
    }

    currentIndex++;
    apiIndex++;
  }
  drainCurrentUntil(null);
  drainApiUntil(null);
  return target;
}

function longestCommonSubsequence(left: string[], right: string[]) {
  const rowCount = left.length;
  const columnCount = right.length;
  const lengths = Array.from({ length: rowCount + 1 }, () => Array.from({ length: columnCount + 1 }, () => 0));
  for (let row = rowCount - 1; row >= 0; row--) {
    for (let column = columnCount - 1; column >= 0; column--) {
      lengths[row][column] = left[row] === right[column]
        ? lengths[row + 1][column + 1] + 1
        : Math.max(lengths[row + 1][column], lengths[row][column + 1]);
    }
  }

  const sequence: string[] = [];
  let row = 0;
  let column = 0;
  while (row < rowCount && column < columnCount) {
    if (left[row] === right[column]) {
      sequence.push(left[row]);
      row++;
      column++;
    } else if (lengths[row + 1][column] >= lengths[row][column + 1]) {
      row++;
    } else {
      column++;
    }
  }
  return sequence;
}

type ReflowBandParams = Prettify<{
  currentContents: Prettify<InnerTubeRichGridItem>[];
  currentRuns: {
    start: number;
    end: number;
  }[];
  targetBand: Prettify<InnerTubeRichGridItem>[];
}>;

// Lay the merged band back over the grid array. Non-inline items (section markers, continuation) are
// copied by reference at their original positions; middle runs take exactly their original count of
// band items so each following marker stays at its row, and the last run takes whatever remains so
// the net size change is absorbed there. Any band item whose final index differs from its original
// is cloned so Polymer's index-based rebind can't share sub-objects between shifting tiles.
function reflowBandIntoRuns({ currentContents, currentRuns, targetBand }: ReflowBandParams) {
  const currentIndexByRef = new Map<Prettify<InnerTubeRichGridItem>, number>();
  for (let i = 0; i < currentContents.length; i++) {
    currentIndexByRef.set(currentContents[i], i);
  }

  function pushBandItem(item: Prettify<InnerTubeRichGridItem>, result: Prettify<InnerTubeRichGridItem>[]) {
    const originalIdx = currentIndexByRef.get(item);
    const shouldClone = originalIdx !== undefined && originalIdx !== result.length;
    result.push(shouldClone ? structuredClone(item) : item);
  }

  const lastRunIndex = currentRuns.length - 1;
  const result: Prettify<InnerTubeRichGridItem>[] = [];
  let bandIndex = 0;
  let cursor = 0;
  for (let runIndex = 0; runIndex < currentRuns.length; runIndex++) {
    const run = currentRuns[runIndex];
    while (cursor < run.start) {
      result.push(currentContents[cursor]);
      cursor++;
    }

    const isLastRun = runIndex === lastRunIndex;
    const slotCount = isLastRun ? targetBand.length - bandIndex : run.end - run.start;
    for (let slot = 0; slot < slotCount && bandIndex < targetBand.length; slot++, bandIndex++) {
      pushBandItem(targetBand[bandIndex], result);
    }
    cursor = run.end;
  }

  while (cursor < currentContents.length) {
    result.push(currentContents[cursor]);
    cursor++;
  }
  return result;
}

function findAllInlineRuns(contents: Prettify<InnerTubeRichGridItem>[]) {
  const runs: {
    start: number;
    end: number;
  }[] = [];
  let runStart = -1;
  for (let i = 0; i < contents.length; i++) {
    const hasInline = !!videoIdFromRichItem(contents[i]);
    if (hasInline && runStart === -1) {
      runStart = i;
    }

    if (!hasInline && runStart !== -1) {
      runs.push({
        start: runStart,
        end: i
      });
      runStart = -1;
    }
  }

  if (runStart !== -1) {
    runs.push({
      start: runStart,
      end: contents.length
    });
  }

  return runs;
}

function collectAllGridVideoIds(contents: Prettify<InnerTubeRichGridItem>[]) {
  const ids = new Set<string>();
  for (const item of contents) {
    const topId = videoIdFromRichItem(item);
    if (topId) {
      ids.add(topId);
    }

    const shelfContents = item?.richSectionRenderer?.content?.richShelfRenderer?.contents ?? [];
    for (const nested of shelfContents) {
      const nestedId = videoIdFromRichItem(nested);
      if (nestedId) {
        ids.add(nestedId);
      }
    }
  }
  return ids;
}

function isReferenceEqualArray(left: readonly unknown[], right: readonly unknown[]) {
  return left.length === right.length && left.every((item, i) => item === right[i]);
}

function findNewlyInsertedElements(newVideoIds: Set<string>) {
  const result: HTMLElement[] = [];
  const seen = new Set<string>();
  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    const isFirstMatch = !!videoId && newVideoIds.has(videoId) && !seen.has(videoId);
    if (isFirstMatch) {
      seen.add(videoId);
      result.push(elItem);
    }
  }
  return result;
}
