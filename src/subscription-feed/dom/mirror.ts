import { isAnimationsEnabled } from "../settings-state";
import type { InnerTubeRichGridItem } from "../types/innertube";
import type { PolymerElement } from "../types/polymer";
import type { Prettify } from "../types/prettify";
import { flushPolymerRender, isPolymerElement } from "../utils/polymer";
import { deepArray } from "../utils/records";
import { videoIdFromData } from "../utils/video-id";
import { gridDataSchema } from "../youtube-api/schemas";
import { isInViewport } from "./animations";
import { preloadThumbnail } from "./build";
import {
  avatarUrlFromContent,
  isCollaborativeRichItem,
  thumbnailUrlFromContent,
  thumbnailUrlFromRichItem,
  videoIdFromRichItem
} from "./rich-item";

// Reconciles the Latest-band inline videos with the API. Shelf wrappers (richSectionRenderer) and
// continuation items pass through by reference, so Polymer's dom-repeat never re-renders them; only
// root-level richItemRenderers are touched.
//
// The dom-repeat is index-based: replacing data.contents rebinds each node to whatever item now sits
// at its index, so a front insert shifts every node's video and each must repaint its thumbnail.
// YouTube paints a thumbnail once and skips repaints on data-change, re-asserting it only on scroll -
// so we stand in for that scroll, re-asserting each tile's src until the grid settles.

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

  // A view transition can't drive this: rAF is stalled for the whole transition, so survivors never
  // move until it ends. Instead it's a FLIP - snapshot a ghost of each leaving tile, write the new
  // contents, hold every survivor at its old slot, then release them all at once so they glide to
  // their new slots while joining tiles scale in and the ghosts fade out, all over the same 380ms.
  // Reduced motion skips it with an instant write.
  if (!isAnimationsEnabled()) {
    elGrid.set("data.contents", newContents);
  } else {
    const removalGhosts = createRemovalGhosts(findRemovedViewportTiles(newContents));
    await setContentsWithFlip({
      elGrid,
      newContents,
      newlyInsertedIds,
      newThumbnailUrls,
      removalGhosts
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
// The FLIP itself: snapshot survivor positions, write, hold each survivor at its old position every
// frame until Polymer's deferred rebind settles, then release them all together so they glide as one.
async function setContentsWithFlip(
  { elGrid, newContents, newlyInsertedIds, newThumbnailUrls, removalGhosts }: SetContentsParams
) {
  if (!isPolymerElement(elGrid)) {
    return;
  }

  const newInlineIds = new Set(newContents.map(videoIdFromRichItem).filter((id): id is string => !!id));
  const expectedInlineIds = [...newInlineIds].join();

  // Rebinding a tile clears its thumbnail/avatar src and repaints only after decode - synchronous on
  // Chromium, deferred on Firefox (a frame or two of blank). This observer mirrors the bound image
  // into a CSS background the moment the src is cleared, ahead of paint, so survivors never flash empty.
  const imageCoverObserver = observeAndCoverBlankImages(elGrid);

  // One frame before the write, paint each survivor's future thumbnail as a background on its stable
  // ytd-rich-item-renderer (which YouTube never replaces). A cover applied during the write can paint
  // too late or be discarded when Firefox swaps the lockup subtree; a background set a frame early has
  // already rasterised when the <img> blanks, so the thumbnail shows with no gap.
  await new Promise<void>(resolve =>
    requestAnimationFrame(() => {
      preCoverReflowImages(newContents, newlyInsertedIds);
      resolve();
    }));

  // Record positions, write, and pin in one rAF so they all land before that frame paints. flush()
  // does not synchronously reposition dom-repeat nodes, so pinning outside a rAF would see delta=0
  // and leave survivors un-pinned.
  const oldRects = await new Promise<Map<string, DOMRect>>(resolve =>
    requestAnimationFrame(() => {
      const rects = recordReflowZoneRects();
      elGrid.set("data.contents", newContents);
      flushPolymerRender();
      hideNewInsertedTiles(newlyInsertedIds);
      // Repaint before pinning so any compositor frame mid-loop shows the right thumbnail, not the
      // blank Polymer left behind.
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
      hideNewInsertedTiles(newlyInsertedIds);
      repaintInlineThumbnails();
      coverBlankImages();
      pinSurvivorsToOldRects(pinParams);
      resolve();
    }));
    stableFrames = inlineDomVideoIds() === expectedInlineIds ? stableFrames + 1 : 0;
  }

  // The single release moment: survivors glide old -> new, joining tiles scale in, leaving ghosts
  // fade out - all starting on the same frame.
  releaseSurvivors();
  dissolveRemovalGhosts(removalGhosts);
  repaintInlineThumbnails();
  coverBlankImages();
  coverNewlyInsertedTiles({
    newlyInsertedIds,
    newThumbnailUrls
  });
  animateNewEntrances(newlyInsertedIds);

  // Keep the cover observer alive through the glide: a release-time repaint or late re-stamp can blank
  // a tile just as the slide starts. Each cover drops itself on its tile's load.
  for (let i = 0; i < Math.ceil(SURVIVOR_SHIFT_MS / 16) + 2; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  imageCoverObserver?.disconnect();
  clearReflowImageCovers();
  clearRemovalGhosts();
}

// Give each surviving tile a fallback thumbnail/avatar one frame before the write. The tile node
// (ytd-rich-item-renderer) is stable, but YouTube swaps the inner image containers on ~1 in 3 rebinds,
// so the overlay is pinned to the tile node at z-index:-1 - behind the real <img>, so it only shows
// through while the rebound image is briefly blank. The i-th tile binds to the i-th item; new tiles
// have no prior image and are skipped (coverNewlyInsertedTiles handles those).
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

type CoverNewTilesParams = Prettify<{
  newlyInsertedIds: Set<string>;
  newThumbnailUrls: Map<string, string>;
}>;

// New tiles slide in via the entrance animation rather than the survivor reflow, so preCoverReflowImages
// skips them - there is no prior on-screen image to hold. Once Polymer has stamped each new tile, cover
// its thumbnail with the already-preloaded URL (a z-index:-1 overlay on the stable tile node, behind the
// real <img>) so the entrance slide shows the thumbnail instead of a blank while the <img> decodes. Each
// overlay drops as soon as its <img> loads; clearReflowImageCovers is the final sweep.
function coverNewlyInsertedTiles({ newlyInsertedIds, newThumbnailUrls }: CoverNewTilesParams) {
  if (newlyInsertedIds.size === 0) {
    return;
  }

  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isInViewport(elItem) || !isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    const thumbUrl = videoId ? newThumbnailUrls.get(videoId) : "";
    const elThumb = thumbnailContainerInItem(elItem);
    if (!videoId || !newlyInsertedIds.has(videoId) || !thumbUrl || !elThumb) {
      continue;
    }

    prepareCoverHost(elItem);
    const thumbRadius = getComputedStyle(elThumb).borderRadius;
    const elOverlay = addCoverOverlay(
      elItem,
      thumbUrl,
      elThumb.getBoundingClientRect(),
      elItem.getBoundingClientRect(),
      thumbRadius
    );
    dropOverlayWhenThumbnailLoads(elItem, elOverlay);
  }
}

function dropOverlayWhenThumbnailLoads(elItem: HTMLElement, elOverlay: HTMLElement | null) {
  if (!elOverlay) {
    return;
  }

  for (const elImg of thumbnailImgsInItem(elItem)) {
    if (elImg.complete && elImg.naturalWidth > 0) {
      elOverlay.remove();
      return;
    }

    elImg.addEventListener("load", () => elOverlay.remove(), { once: true });
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
    return null;
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
  return elOverlay;
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

type SetContentsParams = Prettify<{
  elGrid: HTMLElement;
  newContents: Prettify<InnerTubeRichGridItem>[];
  newlyInsertedIds: Set<string>;
  newThumbnailUrls: Map<string, string>;
  removalGhosts: HTMLElement[];
}>;

// A leaving tile's node is reused by Polymer the instant we write the shorter contents, so it can't
// animate itself out. Instead, just before the write, freeze a fixed-position snapshot ("ghost") of
// each leaving tile at its on-screen spot. The ghost survives the write and is faded out at the release
// moment, so the leaver dissolves in place while the survivors glide in to close the gap.
//
// The snapshot is a clone of the tile's view-model (yt-lockup-view-model / shorts), which renders to
// light DOM and clones intact, so the whole card - thumbnail and metadata - dissolves as one. Cloning
// the Polymer ytd-rich-item-renderer wrapper instead re-stamps it empty, and a thumbnail-only ghost
// drops the metadata a frame before the slide (a visible two-stage removal). A legacy renderer can't be
// cloned, so it falls back to a thumbnail-only ghost.
const REMOVAL_GHOST_ATTR = "data-ytaf-removal-ghost";
const GHOST_CLONEABLE_SELECTOR =
  "yt-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model";

function createRemovalGhosts(elRemovedTiles: HTMLElement[]) {
  const ghosts: HTMLElement[] = [];
  for (const elTile of elRemovedTiles) {
    const elGhost = cloneTileGhost(elTile) ?? thumbnailGhost(elTile);
    if (elGhost) {
      document.body.append(elGhost);
      ghosts.push(elGhost);
    }
  }
  return ghosts;
}

// Clone the whole view-model so thumbnail and metadata dissolve together. The cloned <img> re-decodes
// from cache, so its already-painted picture is held as a background to bridge that decode.
function cloneTileGhost(elTile: HTMLElement) {
  const elContent = elTile.querySelector<HTMLElement>(GHOST_CLONEABLE_SELECTOR);
  if (!elContent) {
    return null;
  }

  const rect = elContent.getBoundingClientRect();
  if (rect.width === 0) {
    return null;
  }

  const elGhost = elContent.cloneNode(true) as HTMLElement;
  positionRemovalGhost(elGhost, rect);
  paintGhostThumbnailBackground(elTile, elGhost);
  return elGhost;
}

function thumbnailGhost(elTile: HTMLElement) {
  const elThumb = thumbnailContainerInItem(elTile);
  const url = thumbnailImgsInItem(elTile).map(elImg => elImg.currentSrc || elImg.src).find(Boolean);
  if (!elThumb || !url) {
    return null;
  }

  const rect = elThumb.getBoundingClientRect();
  if (rect.width === 0) {
    return null;
  }

  const elGhost = document.createElement("div");
  positionRemovalGhost(elGhost, rect);
  const { style } = elGhost;
  style.borderRadius = getComputedStyle(elThumb).borderRadius;
  style.backgroundImage = `url("${url}")`;
  style.backgroundSize = "cover";
  style.backgroundPosition = "center";
  return elGhost;
}

function positionRemovalGhost(elGhost: HTMLElement, rect: DOMRect) {
  elGhost.setAttribute(REMOVAL_GHOST_ATTR, "1");
  const { style } = elGhost;
  style.position = "fixed";
  style.left = `${rect.left}px`;
  style.top = `${rect.top}px`;
  style.width = `${rect.width}px`;
  style.height = `${rect.height}px`;
  style.margin = "0";
  style.zIndex = "2000";
  style.pointerEvents = "none";
}

function paintGhostThumbnailBackground(elTile: HTMLElement, elGhost: HTMLElement) {
  const url = thumbnailImgsInItem(elTile).map(elImg => elImg.currentSrc || elImg.src).find(Boolean);
  if (!url) {
    return;
  }

  for (const elImg of elGhost.querySelectorAll<HTMLImageElement>("yt-thumbnail-view-model img")) {
    elImg.style.backgroundImage = `url("${url}")`;
    elImg.style.backgroundSize = "cover";
    elImg.style.backgroundPosition = "center";
  }
}

function dissolveRemovalGhosts(ghosts: HTMLElement[]) {
  for (const elGhost of ghosts) {
    elGhost.style.transition = `opacity ${SURVIVOR_SHIFT_MS}ms ease, scale ${SURVIVOR_SHIFT_MS}ms ease`;
    elGhost.style.opacity = "0";
    elGhost.style.scale = "0.92";
    elGhost.addEventListener("transitionend", () => elGhost.remove(), { once: true });
  }
}

function clearRemovalGhosts() {
  for (const elGhost of document.querySelectorAll(`[${REMOVAL_GHOST_ATTR}]`)) {
    elGhost.remove();
  }
}

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

// Reconcile the Latest band (every top-level inline video, across all runs) to the API by diffing the
// two id sequences. Their common subsequence stays put; new API videos slot in at their API position,
// reordered ones follow the API, and dropped ones linger for STICKY_DELETE_POLLS polls so the noisy
// pagination tail can't flicker tiles. The merged band is then laid back over the run structure:
// markers pass through untouched (each keeps its row) and the last run absorbs the size change.
function composeNewContents({ apiContents, currentContents }: ComposeNewContentsParams) {
  const currentRuns = findAllInlineRuns(currentContents);
  if (currentRuns.length === 0) {
    return currentContents;
  }

  const currentBand = extractInlineBand(currentContents);
  const currentBandIds = new Set(currentBand.map(entry => entry.videoId));

  // The inline band mirrors the API's top-level inline run verbatim. A video YouTube emits in both the
  // inline band and a shelf (e.g. a fresh upload also surfaced under Most relevant) is rendered in both,
  // exactly as YouTube does - de-duping it against shelf membership drops the newest upload from Latest.
  const apiBand = extractInlineBand(apiContents);
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

// Walk both bands against their shared subsequence. Between two anchors, retained-dropped videos
// (absent from the API but still inside the sticky window) keep their slot, then the API's new or
// reordered videos fill in. Each video reuses its live item reference, so one whose index is unchanged
// keeps its existing dom-repeat node - no thumbnail reload, no flash. reflowBandIntoRuns then clones
// only the items whose index moved, so a shifted item can't share sub-objects with its old neighbour.
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
