import type { InnerTubeRichGridItem } from "../types/innertube";
import type { PolymerElement } from "../types/polymer";
import type { Prettify } from "../types/prettify";
import { isPolymerElement } from "../utils/polymer";
import { deepArray, isRecord } from "../utils/records";
import { videoIdFromData } from "../utils/video-id";
import { isInViewport, prefersReducedMotion, triggerAnimation } from "./animations";
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
const REBIND_MICROTASK_POLL_MAX = 20;
const REBIND_FRAME_POLL_MAX = 10;
const GRID_ITEM_SELECTOR = "ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer";
const GRID_SECTION_SELECTOR = "ytd-rich-grid-renderer > #contents > ytd-rich-section-renderer";

// High-water mark of the API's Latest-band size across the session. Caps how far stickiness can
// grow the local band so it never exceeds a size YouTube has actually emitted.
let latestBandObservedCap = 0;

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
    apiContents,
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

interface PreMutationRects {
  inline: Map<string, DOMRect>;
  sections: Map<unknown, DOMRect>;
}

function capturePreMutationRects(newlyInsertedIds: Set<string>): PreMutationRects {
  const inline = new Map<string, DOMRect>();
  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    const isSurvivingItem = !!videoId && !newlyInsertedIds.has(videoId);
    if (isSurvivingItem) {
      inline.set(videoId, elItem.getBoundingClientRect());
    }
  }

  // Section markers are passed through by reference (composeNewContents reuses the same
  // richSectionRenderer object), so the data object itself is a stable identity across the
  // mutation. Capture by that reference so the new section element (Polymer rebinds dom-repeat
  // children when the array shifts) can be matched back to its pre-mutation position.
  const sections = new Map<unknown, DOMRect>();
  for (const elSection of document.querySelectorAll<HTMLElement>(GRID_SECTION_SELECTOR)) {
    if (!isPolymerElement(elSection)) {
      continue;
    }

    sections.set(elSection.data, elSection.getBoundingClientRect());
  }

  return {
    inline,
    sections
  };
}

async function runCascadeAndEntrance({ firstRects, newlyInsertedIds }: {
  firstRects: PreMutationRects;
  newlyInsertedIds: Set<string>;
}) {
  // Polymer debounces dom-repeat rendering through microtasks. The outer dom-repeat rebind, the
  // dom-if template swaps at indices whose item type changed (richItem <-> richSection at a slot
  // when an inline item shifts past a shelf), and the inner shelf templates each tick on their
  // own microtask cycle. We poll until: (1) every newly inserted videoId has a rich-item-renderer
  // and (2) every captured section's data ref is live on a rich-section-renderer. Without (2),
  // the loop exits the moment V_NEW lands and the cascade reads a DOM where a displaced shelf
  // hasn't been re-stamped at its new slot yet - missing it from the FLIP and producing the
  // visible bounce.
  function isRebindComplete() {
    if (findNewlyInsertedElements(newlyInsertedIds).length !== newlyInsertedIds.size) {
      return false;
    }

    const liveSectionRefs = new Set<unknown>();
    for (const elSection of document.querySelectorAll<HTMLElement>(GRID_SECTION_SELECTOR)) {
      if (isPolymerElement(elSection)) {
        liveSectionRefs.add(elSection.data);
      }
    }
    for (const sectionRef of firstRects.sections.keys()) {
      if (!liveSectionRefs.has(sectionRef)) {
        return false;
      }
    }
    return true;
  }
  for (let i = 0; i < REBIND_MICROTASK_POLL_MAX && !isRebindComplete(); i++) {
    await Promise.resolve();
  }
  for (let i = 0; i < REBIND_FRAME_POLL_MAX && !isRebindComplete(); i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }

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

function cascadeDisplacedItems(firstRects: PreMutationRects) {
  const moves: {
    elItem: HTMLElement;
    deltaX: number;
    deltaY: number;
  }[] = [];

  function recordMoveIfDisplaced(elItem: HTMLElement, firstRect: DOMRect) {
    if (!isInViewport(elItem)) {
      return;
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

  for (const elItem of document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    const firstRect = videoId ? firstRects.inline.get(videoId) : null;
    if (!firstRect) {
      continue;
    }

    recordMoveIfDisplaced(elItem, firstRect);
  }

  for (const elSection of document.querySelectorAll<HTMLElement>(GRID_SECTION_SELECTOR)) {
    if (!isPolymerElement(elSection)) {
      continue;
    }

    const firstRect = firstRects.sections.get(elSection.data);
    if (!firstRect) {
      continue;
    }

    recordMoveIfDisplaced(elSection, firstRect);
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

function composeNewContents({ apiContents, currentContents }: {
  apiContents: Prettify<InnerTubeRichGridItem>[];
  currentContents: Prettify<InnerTubeRichGridItem>[];
  desiredInlineSequence: Prettify<InnerTubeRichGridItem>[];
}) {
  // Mirror the API's Latest band 1:1 - the videos that appear before any rich shelf in the API
  // are emitted in API order at the top of the grid, with the same number of slots. Everything
  // past current's first rich shelf (the rich shelves themselves, the videos that sit between
  // them, the continuation) is passed through from current unchanged, so the page's section
  // order is preserved regardless of how the API itself segments the feed on a given poll.
  // Adds, removes, and reorders inside the Latest band fall out of this naturally; anything that
  // would touch the rest of the grid is intentionally ignored.
  const apiLatestVideos: Prettify<InnerTubeRichGridItem>[] = [];
  for (const apiItem of apiContents) {
    if (apiItem.richSectionRenderer?.content?.richShelfRenderer) {
      break;
    }

    if (videoIdFromRichItem(apiItem)) {
      apiLatestVideos.push(apiItem);
    }
  }

  const hasLeadingLegacyShelf = !!currentContents[0]?.richSectionRenderer
    && !currentContents[0]?.richSectionRenderer?.content?.richShelfRenderer;
  const latestStartIdx = hasLeadingLegacyShelf ? 1 : 0;
  let latestEndIdx = currentContents.length;
  for (let i = latestStartIdx; i < currentContents.length; i++) {
    const item = currentContents[i];
    const isBandEnd = !!item.richSectionRenderer?.content?.richShelfRenderer
      || !!item.continuationItemRenderer;
    if (isBandEnd) {
      latestEndIdx = i;
      break;
    }
  }

  // Reuse current refs for videos that are already in the Latest band so Polymer doesn't tear
  // down and rebuild tiles whose data didn't change - only structuredClone genuinely new uploads.
  const previousLatestItems: {
    videoId: string;
    item: Prettify<InnerTubeRichGridItem>;
  }[] = [];
  const previousLatestIds = new Set<string>();
  for (let i = latestStartIdx; i < latestEndIdx; i++) {
    const item = currentContents[i];
    const videoId = videoIdFromRichItem(item);
    if (videoId) {
      previousLatestItems.push({
        videoId,
        item
      });
      previousLatestIds.add(videoId);
    }
  }
  // Recover DOM tiles that are still rendered but no longer in data.contents. YouTube's own SPA
  // can mutate the data store between renders and our first mirror cycle, leaving Polymer tiles
  // wedded to a previous state that orphan-cleanup would otherwise remove. Splicing the orphaned
  // tiles back into previousLatestItems at their DOM positions keeps the band's monotone-grow
  // contract honest against external trims.
  const elGridContents = document.querySelector("ytd-rich-grid-renderer > #contents");
  if (elGridContents) {
    let domIdx = 0;
    for (const elChild of elGridContents.children) {
      if (elChild.tagName === "YTD-RICH-SECTION-RENDERER") {
        if (elChild.querySelector("ytd-rich-shelf-renderer")) {
          break;
        }

        continue;
      }

      if (elChild.tagName === "YTD-CONTINUATION-ITEM-RENDERER") {
        break;
      }

      if (!isRichItemElement(elChild)) {
        continue;
      }

      const videoId = videoIdFromData(elChild.data);
      if (videoId && !previousLatestIds.has(videoId)) {
        const insertAt = Math.min(domIdx, previousLatestItems.length);
        previousLatestItems.splice(insertAt, 0, {
          videoId,
          item: { richItemRenderer: structuredClone(elChild.data) }
        });
        previousLatestIds.add(videoId);
      }

      domIdx++;
    }
  }

  const currentLatestById = new Map<string, Prettify<InnerTubeRichGridItem>>();
  for (const { videoId, item } of previousLatestItems) {
    if (!currentLatestById.has(videoId)) {
      currentLatestById.set(videoId, item);
    }
  }

  const apiLatestVideoIds = new Set<string>();
  for (const apiItem of apiLatestVideos) {
    const videoId = videoIdFromRichItem(apiItem);
    if (videoId) {
      apiLatestVideoIds.add(videoId);
    }
  }

  const newLatest = apiLatestVideos.map(apiItem => {
    const videoId = videoIdFromRichItem(apiItem);
    const reused = videoId ? currentLatestById.get(videoId) : undefined;
    return reused ?? structuredClone(apiItem);
  });

  // Monotone-grow sticky: any previous-Latest video the API has dropped this poll is reinserted at
  // its previous index, with no time limit. YouTube's API has a stable head and a noisy tail of
  // 3-5 videos that flicker in and out unpredictably, so any threshold-based eviction shifts the
  // bands below by a row whenever the band size crosses a 3-video boundary. The session-long
  // stickiness eliminates that churn; the cap is the high-water of both the API's Latest count
  // and the locally-rendered band size, so neither the API nor the page's own initial render
  // (which can have more videos than the first /browse poll returns) gets clipped.
  latestBandObservedCap = Math.max(
    latestBandObservedCap,
    apiLatestVideos.length,
    previousLatestItems.length
  );

  for (let i = 0; i < previousLatestItems.length; i++) {
    const { videoId, item } = previousLatestItems[i];
    if (apiLatestVideoIds.has(videoId)) {
      continue;
    }

    const insertAt = Math.min(i, newLatest.length);
    newLatest.splice(insertAt, 0, item);
  }

  if (newLatest.length > latestBandObservedCap) {
    newLatest.length = latestBandObservedCap;
  }

  return [
    ...currentContents.slice(0, latestStartIdx),
    ...newLatest,
    ...currentContents.slice(latestEndIdx)
  ];
}

function isReferenceEqualArray(left: readonly unknown[], right: readonly unknown[]) {
  return left.length === right.length && left.every((item, i) => item === right[i]);
}

function isRichItemElement(
  element: Element
): element is PolymerElement<NonNullable<InnerTubeRichGridItem["richItemRenderer"]>> {
  return element.tagName === "YTD-RICH-ITEM-RENDERER" && isPolymerElement(element);
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
