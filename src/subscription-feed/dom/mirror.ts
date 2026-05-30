import type { InnerTubeRichGridItem } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import { isPolymerElement } from "../utils/polymer";
import { deepArray, isRecord } from "../utils/records";
import { videoIdFromData } from "../utils/video-id";
import { isInViewport, prefersReducedMotion, triggerAnimation, waitForFrames } from "./animations";
import { videoIdFromRichItem } from "./rich-item";

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
const GRID_ITEM_SELECTOR = "ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer";

function isInlineItem(item: Prettify<InnerTubeRichGridItem>) {
  return !!videoIdFromRichItem(item);
}

export function mirrorFromApi({ apiContents }: {
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
  for (const item of desiredInlineSequence) {
    const videoId = videoIdFromRichItem(item);
    if (videoId && !previousInlineIds.has(videoId)) {
      newlyInsertedIds.add(videoId);
    }
  }

  const firstRects = capturePreMutationRects(newlyInsertedIds);

  elGrid.set("data.contents", newContents);

  void runCascadeAndEntrance({
    firstRects,
    newlyInsertedIds
  });
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

  if (!prefersReducedMotion()) {
    cascadeDisplacedItems(firstRects);
  }

  animateEntranceItems(newlyInsertedIds);
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

  // INVERT: apply the inverse translation synchronously so the item visually stays in its old
  // position even though its grid slot has already moved.
  for (const { elItem, deltaX, deltaY } of moves) {
    elItem.style.transition = "none";
    elItem.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
  }

  // PLAY: in the next frame, clear the transform with a transition so the item slides to its new
  // grid slot. A tile in the last column whose new slot is first column of next row gets a natural
  // diagonal slide because deltaX and deltaY are both non-zero.
  requestAnimationFrame(() => {
    for (const { elItem } of moves) {
      elItem.style.transition = `transform ${CASCADE_DURATION_MS}ms ${CASCADE_EASING}`;
      elItem.style.transform = "";
      elItem.addEventListener("transitionend", () => {
        elItem.style.transition = "";
        elItem.style.transform = "";
      }, { once: true });
    }
  });
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
  // Reuse existing Edge inline objects when their videoId still appears in the API. This preserves
  // Polymer's element identity for unchanged videos so it can patch in place rather than re-render.
  const reuseByVideoId = new Map<string, Prettify<InnerTubeRichGridItem>>();
  for (const item of currentContents) {
    const videoId = videoIdFromRichItem(item);
    if (videoId) {
      reuseByVideoId.set(videoId, item);
    }
  }

  const sequence: Prettify<InnerTubeRichGridItem>[] = [];
  const placed = new Set<string>();
  for (const apiItem of apiContents) {
    const videoId = videoIdFromRichItem(apiItem);
    if (!videoId || placed.has(videoId)) {
      continue;
    }

    placed.add(videoId);
    sequence.push(reuseByVideoId.get(videoId) ?? apiItem);
  }

  // Edge inline videos that have aged out of the API stay in the feed. YouTube only drops a video
  // because it's beyond the top-100 chronological window, not because the channel deleted it -
  // removing it would erase a video the user can still legitimately watch. Append them after the
  // API videos so newer uploads (which arrive at the top of the API list) push them down.
  for (const item of currentContents) {
    const videoId = videoIdFromRichItem(item);
    if (videoId && !placed.has(videoId)) {
      placed.add(videoId);
      sequence.push(item);
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
