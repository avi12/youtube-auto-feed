import type { InnerTubeRichGridItem } from "../types/innertube";
import type { PolymerElement } from "../types/polymer";
import type { Prettify } from "../types/prettify";
import { isPolymerElement } from "../utils/polymer";
import { deepArray, isRecord } from "../utils/records";
import { videoIdFromData } from "../utils/video-id";
import { isInViewport, prefersReducedMotion, triggerAnimation, waitForFrames } from "./animations";
import { preloadThumbnail } from "./build";
import { thumbnailUrlFromContent, thumbnailUrlFromRichItem, videoIdFromRichItem } from "./rich-item";
import { findThumbnailImgInItem } from "./update/thumbnail";

// Reconciles Edge's Latest band inline videos with the API's emission. The new data.contents is
// rebuilt each poll, but every richSectionRenderer (shelf wrapper) and continuationItemRenderer is
// passed through by reference from the previous contents - never reconstructed. That way Polymer's
// dom-repeat sees identical object identity for the shelves and won't re-render or alter their
// inner contents. Only inline video slots (root-level richItemRenderers) are mutated, and only to
// match the API's order/membership.
//
// When a new video is inserted, the existing tiles all shift one slot forward via a FLIP
// (First-Last-Invert-Play) cascade: each surviving tile is captured before the mutation, then
// transformed by its (old - new) delta after the mutation, then animated back to identity. A tile
// in the last column of a row naturally slides diagonally into the first column of the next row,
// because the grid layout places it there post-mutation. The new tile itself uses the .ytsua-new
// scale+opacity entrance animation.

const CASCADE_DURATION_MS = 400;
const CASCADE_EASING = "cubic-bezier(0.05, 0.7, 0.1, 1)";
const POSITION_EPSILON_PX = 0.5;
const THUMBNAIL_PRELOAD_TIMEOUT_MS = 1000;
const THUMBNAIL_REFRESH_FRAMES = 16;
const GRID_ITEM_SELECTOR = "ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer";

function isInlineItem(item: Prettify<InnerTubeRichGridItem>) {
  return !!videoIdFromRichItem(item);
}

export async function mirrorFromApi({ apiContents }: {
  apiContents: Prettify<InnerTubeRichGridItem>[];
}) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const currentContents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents");
  if (currentContents.length === 0) {
    return;
  }

  const previousInlineIds = collectInlineVideoIds(currentContents);
  const desiredInlineSequence = buildDesiredInlineSequence({
    apiContents,
    currentContents
  });
  const newContents = composeNewContents({
    currentContents,
    desiredInlineSequence
  });
  if (isReferenceEqualArray(currentContents, newContents)) {
    return;
  }

  const newlyInsertedIds = new Set<string>();
  const newThumbnailUrls = new Map<string, string>();
  for (const item of desiredInlineSequence) {
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

  const firstRects = capturePreMutationRects(newlyInsertedIds);

  elGrid.set("data.contents", newContents);

  void runCascadeAndEntrance({
    firstRects,
    newlyInsertedIds
  });
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

function capturePreMutationRects(newlyInsertedIds: Set<string>) {
  const rects = new Map<string, DOMRect>();
  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    const isSurvivingItem = !!videoId && !newlyInsertedIds.has(videoId);
    if (isSurvivingItem) {
      rects.set(videoId, elItem.getBoundingClientRect());
    }
  }
  return rects;
}

async function runCascadeAndEntrance({ firstRects, newlyInsertedIds }: {
  firstRects: Map<string, DOMRect>;
  newlyInsertedIds: Set<string>;
}) {
  await waitForFrames({
    predicate: () => findNewlyInsertedElements(newlyInsertedIds).length === newlyInsertedIds.size
  });

  refreshInlineThumbnails();

  if (!prefersReducedMotion()) {
    cascadeDisplacedItems(firstRects);
  }

  animateEntranceItems(newlyInsertedIds);

  // YouTube's image binding clears <img src> on Polymer rebind and re-populates asynchronously
  // over the next several frames - sooner for in-viewport tiles, later for off-screen ones. We
  // keep re-asserting from .data.content so any late YouTube write doesn't leave a stale src.
  for (let i = 0; i < THUMBNAIL_REFRESH_FRAMES; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    refreshInlineThumbnails();
  }
}

function refreshInlineThumbnails() {
  type RichItemElement = PolymerElement<NonNullable<InnerTubeRichGridItem["richItemRenderer"]>>;
  for (const elItem of document.querySelectorAll<RichItemElement>(GRID_ITEM_SELECTOR)) {
    const url = thumbnailUrlFromContent(elItem.data.content);
    if (!url) {
      continue;
    }

    const elImg = findThumbnailImgInItem(elItem);
    if (elImg && elImg.src !== url) {
      elImg.src = url;
    }
  }
}

function cascadeDisplacedItems(firstRects: Map<string, DOMRect>) {
  const moves: {
    elItem: HTMLElement;
    deltaX: number;
    deltaY: number;
  }[] = [];
  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    const firstRect = videoId ? firstRects.get(videoId) : null;
    if (!firstRect) {
      continue;
    }

    if (!isInViewport(elItem)) {
      continue;
    }

    const lastRect = elItem.getBoundingClientRect();
    const deltaX = firstRect.left - lastRect.left;
    const deltaY = firstRect.top - lastRect.top;
    const hasMoved = Math.abs(deltaX) > POSITION_EPSILON_PX || Math.abs(deltaY) > POSITION_EPSILON_PX;
    if (hasMoved) {
      moves.push({
        elItem,
        deltaX,
        deltaY
      });
    }
  }

  // FLIP via Web Animations: animate from the inverted offset back to the resting position so the
  // tile visually slides into its new grid slot. Pointer events are disabled for the duration so a
  // displaced tile that visually covers the new insertion slot doesn't intercept clicks meant for
  // it. Using onfinish + oncancel guarantees the pointer-events restore runs even if a subsequent
  // mutation cancels the animation, which transitionend would silently swallow.
  for (const { elItem, deltaX, deltaY } of moves) {
    elItem.style.pointerEvents = "none";
    const anim = elItem.animate(
      [
        { translate: `${deltaX}px ${deltaY}px` },
        { translate: "none" }
      ],
      {
        duration: CASCADE_DURATION_MS,
        easing: CASCADE_EASING
      }
    );
    function restorePointerEvents() {
      elItem.style.pointerEvents = "";
    }
    anim.onfinish = restorePointerEvents;
    anim.oncancel = restorePointerEvents;
  }
}

function animateEntranceItems(newVideoIds: Set<string>) {
  if (newVideoIds.size === 0) {
    return;
  }

  const elNewItems = findNewlyInsertedElements(newVideoIds);
  const total = elNewItems.length;
  for (let i = 0; i < elNewItems.length; i++) {
    const elItem = elNewItems[i];
    elItem.style.setProperty("--ytsua-new-index", String(i));
    elItem.style.setProperty("--ytsua-new-count", String(total));
    triggerAnimation({
      elTarget: elItem,
      animationClass: "ytsua-new"
    });
  }
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

function buildDesiredInlineSequence({ apiContents, currentContents }: {
  apiContents: Prettify<InnerTubeRichGridItem>[];
  currentContents: Prettify<InnerTubeRichGridItem>[];
}) {
  // Two competing constraints. (1) Polymer's path-effect rebind transiently shares sub-objects
  // across rows when a video shifts position, leaving stale fields wedged in currentContents
  // (e.g. shifted tile carrying the previous occupant's thumbnail URL). (2) Handing Polymer a
  // fresh reference at a slot it already had triggers a full rebind on that row, which YouTube
  // renders as a metadata flicker every poll. The split below resolves both: rows whose video
  // is unchanged at the same inline index keep their existing reference (no rebind, no flicker),
  // while rows that shift or are new get a structuredClone so each shifted row owns an isolated
  // tree the path-effect machinery can't reach through.
  const currentInlineItems: Prettify<InnerTubeRichGridItem>[] = [];
  for (const item of currentContents) {
    if (videoIdFromRichItem(item)) {
      currentInlineItems.push(item);
    }
  }
  const currentByVideoId = new Map<string, Prettify<InnerTubeRichGridItem>>();
  for (const item of currentInlineItems) {
    const videoId = videoIdFromRichItem(item);
    if (videoId && !currentByVideoId.has(videoId)) {
      currentByVideoId.set(videoId, item);
    }
  }

  const orderedVideoIds: string[] = [];
  const sourceByVideoId = new Map<string, Prettify<InnerTubeRichGridItem>>();
  const placed = new Set<string>();
  for (const apiItem of apiContents) {
    const videoId = videoIdFromRichItem(apiItem);
    if (!videoId || placed.has(videoId)) {
      continue;
    }

    placed.add(videoId);
    orderedVideoIds.push(videoId);
    sourceByVideoId.set(videoId, apiItem);
  }

  // Aged-out videos (in the grid but no longer in the API window) splice in at the inline index
  // they currently occupy so a video that flickers in and out of the API window stays put rather
  // than bouncing between its API position and the end of the feed.
  for (let iInline = 0; iInline < currentInlineItems.length; iInline++) {
    const item = currentInlineItems[iInline];
    const videoId = videoIdFromRichItem(item);
    if (!videoId || placed.has(videoId)) {
      continue;
    }

    placed.add(videoId);
    const insertAt = Math.min(iInline, orderedVideoIds.length);
    orderedVideoIds.splice(insertAt, 0, videoId);
    sourceByVideoId.set(videoId, item);
  }

  const sequence: Prettify<InnerTubeRichGridItem>[] = [];
  for (let i = 0; i < orderedVideoIds.length; i++) {
    const videoId = orderedVideoIds[i];
    const currentAtSameIndex = currentInlineItems[i];
    const isUnchangedAtSamePosition = !!currentAtSameIndex && videoIdFromRichItem(currentAtSameIndex) === videoId;
    if (isUnchangedAtSamePosition) {
      sequence.push(currentAtSameIndex);
      continue;
    }

    const source = sourceByVideoId.get(videoId);
    if (source) {
      sequence.push(structuredClone(source));
    }
  }

  return sequence;
}

function composeNewContents({ currentContents, desiredInlineSequence }: {
  currentContents: Prettify<InnerTubeRichGridItem>[];
  desiredInlineSequence: Prettify<InnerTubeRichGridItem>[];
}) {
  const newContents: Prettify<InnerTubeRichGridItem>[] = [];
  let inlineCursor = 0;

  for (const item of currentContents) {
    if (isInlineItem(item)) {
      if (inlineCursor < desiredInlineSequence.length) {
        newContents.push(desiredInlineSequence[inlineCursor]);
        inlineCursor++;
      }

      continue;
    }

    // Shelf wrapper or continuation - passed through by reference, never reconstructed.
    newContents.push(item);
  }

  if (inlineCursor < desiredInlineSequence.length) {
    const continuationIdx = newContents.findIndex(item => !!item.continuationItemRenderer);
    const insertAt = continuationIdx === -1 ? newContents.length : continuationIdx;
    const overflow = desiredInlineSequence.slice(inlineCursor);
    newContents.splice(insertAt, 0, ...overflow);
  }

  return newContents;
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
