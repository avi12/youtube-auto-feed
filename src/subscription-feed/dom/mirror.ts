import { isAnimationsEnabled } from "../settings-state";
import type { InnerTubeRichGridItem } from "../types/innertube";
import type { PolymerElement } from "../types/polymer";
import type { Prettify } from "../types/prettify";
import { flushPolymerRender, isPolymerElement } from "../utils/polymer";
import { deepArray } from "../utils/records";
import { videoIdFromData } from "../utils/video-id";
import { gridDataSchema } from "../youtube-api/schemas";
import { animateItemsOut, isInViewport } from "./animations";
import { preloadThumbnail } from "./build";
import {
  avatarUrlFromContent,
  isCollaborativeRichItem,
  thumbnailUrlFromContent,
  thumbnailUrlFromRichItem,
  videoIdFromRichItem
} from "./rich-item";

// Reconciles the Latest band inline videos with the API's emission. Shelf wrappers
// (richSectionRenderer) and continuation items pass through by reference so Polymer's dom-repeat
// never re-renders them. Only root-level richItemRenderers are mutated.
//
// The dom-repeat is index-based: replacing data.contents rebinds each node to the item now at its
// index. A front insert shifts every node's bound video, and each node must repaint its thumbnail -
// YouTube paints a tile's thumbnail once and skips repaints on data-change; only a scroll (viewport
// intersection) re-asserts it. We simulate that: re-assert each tile's src until the grid settles.

const THUMBNAIL_PRELOAD_TIMEOUT_MS = 1000;
const REBIND_MICROTASK_POLL_MAX = 20;
const REBIND_FRAME_POLL_MAX = 10;
// Re-assert thumbnails until THUMBNAIL_STABLE_FRAMES consecutive frames need no correction,
// capped at THUMBNAIL_REASSERT_FRAMES_MAX so a fighting tile can't spin forever (~2s).
const THUMBNAIL_REASSERT_FRAMES_MAX = 120;
const THUMBNAIL_STABLE_FRAMES = 5;
const GRID_ITEM_SELECTOR = "ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer";
// Collaborative (multi-channel) videos flicker in the API's noisy pagination tail, so they are
// buffered for STICKY_DELETE_POLLS before removal. Non-collaborative videos are dropped immediately.
const STICKY_DELETE_POLLS = 4;
const SURVIVOR_SHIFT_MS = 380;
const REMOVAL_SETTLE_FRAMES_MAX = 12;
const REMOVAL_STABLE_FRAMES = 2;
// Include tiles just below the fold - they slide up when something above is removed. The margin
// covers enough rows that multi-item shifts still animate fully.
const REFLOW_MARGIN_BELOW_PX = 1200;
const absenceCountByVideoId = new Map<string, number>();

type MirrorFromApiParams = Prettify<{
  apiContents: Prettify<InnerTubeRichGridItem>[];
}>;

export async function mirrorFromApi({ apiContents }: MirrorFromApiParams) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !gridDataSchema.safeParse(elGrid.data).success) {
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

  // Derive inserted IDs from newContents (what is actually written), not a parallel sequence.
  // Otherwise the entrance animation, thumbnail preload, and rebind-await operate on different IDs
  // than the write - tiles can land without a bound thumbnail or event handlers until Polymer flushes.
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

  // Can't use a view transition: rAF is stalled for the whole transition, so survivors never move
  // until it ends. Instead: fade dropped tiles out, write, FLIP every survivor from its old slot to
  // its new one, release together so they glide simultaneously. Reduced motion gets an instant write.
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

// Reflow zone = viewport + margin below, so tiles sliding up from just under the fold are animated.
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

// Hold each survivor at its pre-write screen position via `translate`. Re-run every frame while
// the grid settles - Polymer re-stamps cloned nodes asynchronously and re-pinning catches whichever
// node currently holds each video. Offset is from the untranslated rect, so it stays correct.
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

// Release each pinned survivor: animate from its held position to its real layout position.
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

// Reflow path for inserts, removals, and reorders. Dropped tiles have already faded out.
// Snapshot survivor positions, write, hold every survivor at its old position each frame until
// the grid's deferred rebind/re-stamp settles, then release so they all glide together.
async function setContentsWithFlip({ elGrid, newContents, newlyInsertedIds }: SetContentsParams) {
  if (!isPolymerElement(elGrid)) {
    return;
  }

  const newInlineIds = new Set(newContents.map(videoIdFromRichItem).filter((id): id is string => !!id));
  const expectedInlineIds = [...newInlineIds].join();

  // When a node is rebound, YouTube clears the thumbnail/avatar src and repaints only after decode.
  // On Chromium this is synchronous; on Firefox it is deferred, leaving tiles blank for a frame or
  // two. This observer covers that gap by mirroring the bound image into a CSS background in the
  // same microtask the src is cleared - ahead of paint - so survivors never flash empty.
  const imageCoverObserver = observeAndCoverBlankImages(elGrid);

  // Paint each survivor's FUTURE thumbnail as a background on the stable tile node one frame before
  // the write. On Firefox the rebind defers clearing the <img> and sometimes replaces the whole
  // lockup subtree - an img-level cover applied during the write paints too late or is discarded with
  // the replaced element. ytd-rich-item-renderer is never replaced, and a background set a frame
  // early has rasterised before the <img> blanks, so the future thumbnail shows with no gap.
  await new Promise<void>(resolve =>
    requestAnimationFrame(() => {
      preCoverReflowImages(newContents, newlyInsertedIds);
      resolve();
    }));

  // Write and first pin inside one rAF so the mutation and pins land before the same frame's paint.
  // Polymer.flush() does not synchronously reposition dom-repeat nodes - a pin outside a rAF would
  // compute delta=0 and leave survivors un-pinned for the paint that follows animationend.
  const oldRects = await new Promise<Map<string, DOMRect>>(resolve =>
    requestAnimationFrame(() => {
      const rects = recordReflowZoneRects();
      elGrid.set("data.contents", newContents);
      flushPolymerRender();
      revealReboundSurvivors(newInlineIds);
      hideNewInsertedTiles(newlyInsertedIds);
      // Correct thumbnails before pinning so any mid-loop compositor frame shows correct
      // thumbnails rather than the blank state Polymer left behind.
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

  // Keep the cover observer live through the slide: the release-time repaint or a late YouTube
  // re-stamp can blank a tile after the settle loop, just as videos start sliding. Each cover is
  // dropped by its per-tile load handler once the image lands.
  for (let i = 0; i < Math.ceil(SURVIVOR_SHIFT_MS / 16) + 2; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  imageCoverObserver?.disconnect();
  clearReflowImageCovers();
}

// Pre-cover reflow-zone survivor thumbnails and avatars one frame before the write. Overlays are
// placed on the stable ytd-rich-item-renderer node (YouTube never replaces it, unlike the thumbnail
// and avatar containers which are swapped wholesale on ~1 in 3 tiles). z-index:-1 keeps each overlay
// behind the real <img>, visible only while the rebound image is blank. Thumbnail overlay uses the
// thumbnail's border-radius; avatar overlay is a circle. DOM order maps to content order (i-th node
// binds to i-th item). New tiles are skipped.
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

// Give the tile an isolated stacking context so z-index:-1 overlays stay behind its content but
// not behind neighbouring tiles.
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

// Mirror each rebound tile's images into a CSS background while the foreground <img> is blank or
// decoding. The cached background paints immediately (the image was just on screen) and is dropped
// once the foreground finishes loading. Both thumbnail and avatar blank on a node shift.
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

  // Avatars live inside lockup shadow roots, which a #contents subtree observer can't reach.
  // Observe those roots too so an avatar src-clear is re-covered in the same microtask, ahead of paint.
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
  // Polymer debounces dom-repeat rebind across microtasks/frames. Wait for new tiles to exist
  // before repainting; otherwise early passes run against a half-rendered grid.
  for (let i = 0; i < REBIND_MICROTASK_POLL_MAX && !areInsertedTilesPresent(newlyInsertedIds); i++) {
    await Promise.resolve();
  }
  for (let i = 0; i < REBIND_FRAME_POLL_MAX && !areInsertedTilesPresent(newlyInsertedIds); i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }

  // Re-assert each tile's thumbnail until stable or capped. The preferred source URL is byte-stable
  // per picture (sqp/rs only rotate when the image changes), so a full-URL compare catches both a
  // rebound tile and a creator-swapped thumbnail without churning.
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

// Every thumbnail <img> in a tile, across the lockup shadow root and each thumbnail container's
// shadow tree. Scoped to yt-thumbnail-view-model / ytd-thumbnail so the channel avatar (outside
// those containers) is never repainted with a video URL. Returning every match is robust to
// whichever element YouTube actually paints in a given layout.
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

// Reconcile the Latest band (all top-level inline videos across runs) to the API via sequence diff.
// The LCS of the two id sequences is kept in place; API-added videos insert at their API position,
// reordered videos follow the API, and dropped videos are retained for STICKY_DELETE_POLLS polls so
// the noisy pagination tail can't flicker tiles. The merged band is re-flowed into the run structure:
// section markers and continuation pass through by reference, middle runs keep their length so each
// marker stays at its row, and the last run absorbs the net size change.
function composeNewContents({ apiContents, currentContents }: ComposeNewContentsParams) {
  const currentRuns = findAllInlineRuns(currentContents);
  if (currentRuns.length === 0) {
    return currentContents;
  }

  const currentBand = extractInlineBand(currentContents);
  const currentBandIds = new Set(currentBand.map(entry => entry.videoId));

  // Exclude API videos that already live inside a shelf (Most relevant / Shorts); pulling them into
  // Latest would render the same video twice.
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

    // Non-collaborative videos are dropped immediately (threshold 0).
    const stickyThreshold = collaborativeIds.has(videoId) ? STICKY_DELETE_POLLS : 0;
    if (absenceCount <= stickyThreshold) {
      retainedDroppedIds.add(videoId);
    }
  }

  // Forget counters for videos that have left the band so a later reappearance starts fresh.
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

// Walk both bands against their LCS. Between anchors: retained-dropped videos (absent from API but
// within the sticky window) keep their slot, then API-side videos (new or reordered) fill in.
// Each video already in the band keeps its live item reference so Polymer's index-based dom-repeat
// reuses the existing node for any unchanged-index video - no thumbnail reload, no flash.
// reflowBandIntoRuns then clones only items whose final index differs from their original, preventing
// path-effect bleed (a moved object sharing a slot with a neighbour's contentImage).
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

// Lay the merged band back over the grid array. Non-inline items (section markers, continuation)
// copy by reference at their original positions. Middle runs keep their original length so each
// following marker stays at its row; the last run absorbs the net size change. Items whose final
// index differs from their original are cloned so Polymer's rebind can't share sub-objects between
// shifting tiles.
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
