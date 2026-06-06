import type { InnerTubeRichGridItem } from "../types/innertube";
import type { PolymerElement } from "../types/polymer";
import type { Prettify } from "../types/prettify";
import { flushPolymerRender, isPolymerElement } from "../utils/polymer";
import { deepArray, isRecord } from "../utils/records";
import { videoIdFromData } from "../utils/video-id";
import {
  assignItemViewTransitionNames,
  buildNewItemTransitionStyle,
  buildShiftTransitionStyle,
  calculateStaggerDelayMs,
  clearAllItemViewTransitionNames,
  clearItemViewTransitionNames,
  extractAnimateIds,
  isInViewport,
  prefersReducedMotion,
  reassignTransitionNames,
  withViewTransitionLock
} from "./animations";
import { preloadThumbnail } from "./build";
import { thumbnailUrlFromContent, thumbnailUrlFromRichItem, videoIdFromRichItem } from "./rich-item";

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
// A video the API has dropped is kept in place until it has been absent for this many consecutive
// polls, so the API's noisy pagination tail (videos that flicker out and back at the page boundary)
// doesn't churn the grid. Genuine removals outlast the threshold and are diffed out.
const STICKY_DELETE_POLLS = 4;
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

  await setContentsAnimated({
    elGrid,
    newContents,
    newlyInsertedIds
  });

  void repaintInsertedThumbnails(newlyInsertedIds);
}

type SetContentsAnimatedParams = Prettify<{
  elGrid: HTMLElement;
  newContents: Prettify<InnerTubeRichGridItem>[];
  newlyInsertedIds: Set<string>;
}>;

// Writes the new contents inside a view transition so the inline (Latest-band) tiles slide to their
// new positions instead of abruptly rebinding. The grid's dom-repeat is index-based: after the write
// each reused node holds a different video, so the names assigned by video id before the write are
// reassigned by the video each node now holds - the browser then matches each video id old -> new
// and animates the move, keeping the thumbnail painted throughout. New videos slide in.
async function setContentsAnimated({ elGrid, newContents, newlyInsertedIds }: SetContentsAnimatedParams) {
  if (!isPolymerElement(elGrid)) {
    return;
  }

  const isAnimatable = "startViewTransition" in document && !prefersReducedMotion();
  if (!isAnimatable) {
    elGrid.set("data.contents", newContents);
    return;
  }

  clearAllItemViewTransitionNames();
  const elShiftItems = [...document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)].filter(isInViewport);
  assignItemViewTransitionNames(elShiftItems);
  const animateIds = extractAnimateIds(elShiftItems);
  const elShiftStyle = buildShiftTransitionStyle({
    elItems: elShiftItems,
    delayPerItemMs: calculateStaggerDelayMs(elShiftItems.length)
  });
  document.head.append(elShiftStyle);
  const elNewItemStyles: HTMLStyleElement[] = [];

  await withViewTransitionLock(async () => {
    try {
      await document.startViewTransition(() => {
        elGrid.set("data.contents", newContents);
        // Flush synchronously rather than awaiting a frame: requestAnimationFrame does not advance
        // inside a view-transition update callback, so awaiting one here stalls the callback until
        // the browser's ~4s transition timeout, freezing the grid (no tile is interactable) the
        // whole time. A synchronous flush applies the dom-repeat rebind in this tick so the new
        // node-to-video binding is ready for reassignTransitionNames immediately.
        flushPolymerRender();
        const elAfter = document.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR);
        reassignTransitionNames({
          elItems: elAfter,
          animateIds
        });
        const elNewItems: HTMLElement[] = [];
        for (const elItem of elAfter) {
          const videoId = isPolymerElement(elItem) ? videoIdFromData(elItem.data) : "";
          if (videoId && newlyInsertedIds.has(videoId) && isInViewport(elItem)) {
            elItem.style.viewTransitionName = `ytsua-item-${videoId}`;
            elNewItems.push(elItem);
          }
        }

        if (elNewItems.length > 0) {
          const elStyle = buildNewItemTransitionStyle(elNewItems);
          document.head.append(elStyle);
          elNewItemStyles.push(elStyle);
        }

        repaintInlineThumbnails();
      }).finished;
    } finally {
      elShiftStyle.remove();
      for (const elStyle of elNewItemStyles) {
        elStyle.remove();
      }
      clearItemViewTransitionNames(elShiftItems);
      clearAllItemViewTransitionNames();
    }
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

function repaintInlineThumbnails() {
  type RichItemElement = PolymerElement<NonNullable<InnerTubeRichGridItem["richItemRenderer"]>>;
  let correctedCount = 0;
  for (const elItem of document.querySelectorAll<RichItemElement>(GRID_ITEM_SELECTOR)) {
    const url = thumbnailUrlFromContent(elItem.data.content);
    if (!url) {
      continue;
    }

    for (const elImg of thumbnailImgsInItem(elItem)) {
      if (elImg.src !== url) {
        elImg.src = url;
        correctedCount++;
      }
    }
  }
  return correctedCount;
}

// Every thumbnail <img> in a tile, across the lockup shadow root and each thumbnail container's own
// shadow tree. Scoped to the thumbnail containers (yt-thumbnail-view-model for lockups, ytd-thumbnail
// for legacy renderers) so the channel avatar - which lives outside them - is never repainted with a
// video thumbnail. Returning every match makes the repaint robust to whichever element YouTube
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

  const retainedDroppedIds = updateAbsenceCountsAndRetain({
    currentBandIds,
    apiBandIds
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
}>;

function updateAbsenceCountsAndRetain({ currentBandIds, apiBandIds }: UpdateAbsenceCountsParams) {
  const retainedDroppedIds = new Set<string>();
  for (const videoId of currentBandIds) {
    if (apiBandIds.has(videoId)) {
      absenceCountByVideoId.delete(videoId);
      continue;
    }

    const absenceCount = (absenceCountByVideoId.get(videoId) ?? 0) + 1;
    absenceCountByVideoId.set(videoId, absenceCount);

    if (absenceCount <= STICKY_DELETE_POLLS) {
      retainedDroppedIds.add(videoId);
    }
  }

  // Forget counters for videos that have left the band entirely so a later reappearance starts fresh.
  for (const videoId of [...absenceCountByVideoId.keys()]) {
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
  const lengths = Array.from({ length: rowCount + 1 }, () => new Array<number>(columnCount + 1).fill(0));
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
