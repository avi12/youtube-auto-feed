import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";
import { flushPolymerRender, isPolymerElement } from "../../utils/polymer";
import { videoIdFromData } from "../../utils/video-id";
import { isInViewport, nextFrame } from "../animations";
import { RICH_ITEM_SELECTOR, SURVIVOR_GLIDE_EASING, SURVIVOR_SHIFT_MS } from "./mirror-constants";
import { playEntrance } from "./mirror-entrances";
import { createRemovalGhosts, dissolveRemovalGhosts } from "./mirror-ghosts";
import { glideToRest, pinAtOffset } from "./mirror-glide";
import { alignOpenMenuToItsVideo, pinOpenMenuToItsVideo, releaseOpenMenu } from "./mirror-open-menu";

// Animated write inside a rich shelf: videos leave, and videos YouTube Semi-Subscribe lists join. A
// joining tile scales into its slot like a Latest-band entrance.
//
// An expanded shelf reflows like the Latest band - survivors
// glide to their new slots, wrapping rows. A collapsed shelf shows one row and hides the overflow with
// display:none, so a removed visible tile leaves a gap: the survivors slide left to fill it and the
// first previously-hidden tile slides one column behind them into the freed last slot, staying a column
// ahead of the nearest survivor so the wide tiles never pile up. That tile's last slot sits at the
// shelf's right edge, so it briefly overhangs it while sliding in; its opacity rides an ease-in-out so
// the leading edge fades up into the slot as it arrives (no empty gap) while the bit still overhanging
// the edge stays faint (no off-screen fly-in).
//
// The shelf's Polymer dom-repeat rebinds nodes in place rather than moving them, and does so
// synchronously on flush. So the FLIP is keyed by the video each node now shows (not by node identity)
// and the survivors must be inverted in the same task as the write, before the browser paints the
// rebound layout. Positions are relative to the shelf's own contents box so a concurrent grid reflow
// moving the whole shelf does not leak into the per-tile deltas.

const MILLISECONDS_PER_FRAME = 1000 / 60;
const PROMOTION_POLL_FRAMES = 8;
const GLIDE_FRAME_BUFFER = 4;

function shelfItemId(elItem: HTMLElement) {
  return isPolymerElement(elItem) ? videoIdFromData(elItem.data) : null;
}

function isVisibleToUser(elItem: HTMLElement) {
  return elItem.offsetWidth > 0 && elItem.offsetHeight > 0;
}

function shelfItems(elShelf: HTMLElement) {
  return [...elShelf.querySelectorAll<HTMLElement>(RICH_ITEM_SELECTOR)];
}

function visibleShelfItems(elShelf: HTMLElement) {
  return shelfItems(elShelf).filter(elItem => elItem.offsetWidth > 0);
}

interface RelativePosition {
  left: number;
  top: number;
}

type RecordVisiblePositionsParams = Prettify<{
  elShelf: HTMLElement;
  elContents: HTMLElement;
}>;

function recordVisiblePositions({ elShelf, elContents }: RecordVisiblePositionsParams) {
  const positions = new Map<string, RelativePosition>();
  const contentsRect = elContents.getBoundingClientRect();
  for (const elItem of visibleShelfItems(elShelf)) {
    const videoId = shelfItemId(elItem);
    if (!videoId) {
      continue;
    }

    const rect = elItem.getBoundingClientRect();
    positions.set(videoId, {
      left: rect.left - contentsRect.left,
      top: rect.top - contentsRect.top
    });
  }
  return positions;
}

function columnSpacing(positions: Map<string, RelativePosition>) {
  const lefts = [...positions.values()].map(position => position.left).sort((left, right) => left - right);
  for (const [i, left] of lefts.entries()) {
    const previousLeft = lefts[i - 1];
    if (previousLeft !== undefined && left - previousLeft > 1) {
      return left - previousLeft;
    }
  }
  return 0;
}

type PinSurvivorsParams = Prettify<{
  elShelf: HTMLElement;
  elContents: HTMLElement;
  beforePositions: Map<string, RelativePosition>;
}>;

function pinSurvivors({ elShelf, elContents, beforePositions }: PinSurvivorsParams) {
  const contentsRect = elContents.getBoundingClientRect();
  const elGliders: HTMLElement[] = [];
  for (const elItem of visibleShelfItems(elShelf)) {
    const videoId = shelfItemId(elItem);
    const before = videoId ? beforePositions.get(videoId) : undefined;
    if (!before) {
      continue;
    }

    const rect = elItem.getBoundingClientRect();
    const isPinned = pinAtOffset({
      elGlider: elItem,
      deltaX: before.left - (rect.left - contentsRect.left),
      deltaY: before.top - (rect.top - contentsRect.top)
    });
    if (isPinned) {
      elGliders.push(elItem);
    }
  }
  return elGliders;
}

type AnimateShelfWriteParams = Prettify<{
  elShelf: HTMLElement;
  contents: Prettify<InnerTubeRichGridItem>[];
  removedVideoIds: Set<string>;
  insertedVideoIds: Set<string>;
}>;

function enterInsertedTiles({ elShelf, insertedVideoIds }: Pick<AnimateShelfWriteParams, "elShelf" | "insertedVideoIds">) {
  for (const elItem of visibleShelfItems(elShelf)) {
    const videoId = shelfItemId(elItem);
    if (videoId && insertedVideoIds.has(videoId)) {
      elItem.style.opacity = "";
      playEntrance(elItem);
    }
  }
}

export async function animateShelfWrite({
  elShelf,
  contents,
  removedVideoIds,
  insertedVideoIds
}: AnimateShelfWriteParams) {
  const elContents = elShelf.querySelector<HTMLElement>("#contents");
  if (!isPolymerElement(elShelf) || !elContents) {
    return;
  }

  const elRemovedTiles = shelfItems(elShelf).filter(elItem => {
    const videoId = shelfItemId(elItem);
    return !!videoId && removedVideoIds.has(videoId) && isVisibleToUser(elItem);
  });
  // Only animate what the user can see. A removal tucked in a collapsed shelf's hidden rows, or a write
  // to a shelf scrolled out of the viewport, has nothing to show - apply it instantly.
  const isInsertionVisible = insertedVideoIds.size > 0 && isInViewport(elContents);
  if (elRemovedTiles.length === 0 && !isInsertionVisible) {
    elShelf.set("data.contents", contents);
    alignOpenMenuToItsVideo();
    return;
  }

  const beforePositions = recordVisiblePositions({
    elShelf,
    elContents
  });
  const slideInDistance = columnSpacing(beforePositions);
  // Pre-hide the overflow so the tile promoted into view starts invisible and does not flash.
  for (const elItem of shelfItems(elShelf).filter(elItem => elItem.offsetWidth === 0)) {
    elItem.style.opacity = "0";
  }

  const ghosts = createRemovalGhosts(elRemovedTiles);

  // Write inside a frame, then invert in the microtask that follows (before the browser paints the
  // rebound layout). A synchronous pin does not establish the transition baseline on Firefox.
  await new Promise<void>(resolve => requestAnimationFrame(() => {
    elShelf.set("data.contents", contents);
    flushPolymerRender();
    resolve();
  }));
  const elGliders = pinSurvivors({
    elShelf,
    elContents,
    beforePositions
  });
  enterInsertedTiles({
    elShelf,
    insertedVideoIds
  });
  pinOpenMenuToItsVideo();

  await nextFrame();
  releaseSurvivors(elGliders);
  releaseOpenMenu().catch(() => {});
  dissolveRemovalGhosts(ghosts);
  await glideNewlyVisible({
    elShelf,
    beforePositions,
    insertedVideoIds,
    slideInDistance
  });
  await clearHiddenOpacity(elShelf);
}

type GlideNewlyVisibleParams = Prettify<{
  elShelf: HTMLElement;
  beforePositions: Map<string, RelativePosition>;
  insertedVideoIds: Set<string>;
  slideInDistance: number;
}>;

async function glideNewlyVisible({
  elShelf,
  beforePositions,
  insertedVideoIds,
  slideInDistance
}: GlideNewlyVisibleParams) {
  for (let iFrame = 0; iFrame < PROMOTION_POLL_FRAMES; iFrame++) {
    const elPromoted = visibleShelfItems(elShelf).filter(elItem => {
      const videoId = shelfItemId(elItem);
      return !!videoId && !beforePositions.has(videoId) && !insertedVideoIds.has(videoId);
    });
    if (elPromoted.length > 0) {
      for (const elItem of elPromoted) {
        const distance = slideInDistance || elItem.getBoundingClientRect().width;
        const isRtl = getComputedStyle(elItem).direction === "rtl";
        elItem.style.transition = "none";
        elItem.style.translate = `${isRtl ? -distance : distance}px 0`;
        elItem.style.opacity = "0";
      }

      await nextFrame();
      releaseEntrants(elPromoted);
      return;
    }

    await nextFrame();
  }
}

function releaseSurvivors(elGliders: HTMLElement[]) {
  for (const elItem of elGliders) {
    glideToRest(elItem);
  }
}

function releaseEntrants(elEntrants: HTMLElement[]) {
  for (const elItem of elEntrants) {
    elItem.style.transition = `translate ${SURVIVOR_SHIFT_MS}ms ${SURVIVOR_GLIDE_EASING}, `
      + `opacity ${SURVIVOR_SHIFT_MS}ms ${SURVIVOR_GLIDE_EASING}`;
    elItem.style.translate = "";
    elItem.style.opacity = "";
    elItem.addEventListener("transitionend", () => {
      elItem.style.transition = "";
      elItem.style.translate = "";
      elItem.style.opacity = "";
    }, { once: true });
  }
}

async function clearHiddenOpacity(elShelf: HTMLElement) {
  const totalFrames = Math.ceil(SURVIVOR_SHIFT_MS / MILLISECONDS_PER_FRAME) + GLIDE_FRAME_BUFFER;
  for (let iFrame = 0; iFrame < totalFrames; iFrame++) {
    await nextFrame();
  }

  for (const elItem of shelfItems(elShelf)) {
    if (elItem.offsetWidth === 0) {
      elItem.style.opacity = "";
    }
  }
}
