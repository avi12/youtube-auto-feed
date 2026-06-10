import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";
import { flushPolymerRender, isPolymerElement } from "../../utils/polymer";
import { videoIdFromData } from "../../utils/video-id";
import { SURVIVOR_SHIFT_MS } from "./mirror-constants";
import { createRemovalGhosts, dissolveRemovalGhosts } from "./mirror-ghosts";

// Animated removal inside a rich shelf. An expanded shelf reflows like the Latest band - survivors
// glide to their new slots, wrapping rows. A collapsed shelf shows one row and hides the overflow with
// display:none, so a removed visible tile leaves a gap: the survivors slide left to fill it and the
// first previously-hidden tile slides in one column behind them into the last slot, a column ahead of
// the nearest survivor so the wide tiles never pile up. That tile starts off the shelf's right edge,
// so its opacity is eased-in - it stays invisible out there and only fades up as it settles in.
//
// The shelf's Polymer dom-repeat rebinds nodes in place rather than moving them, and does so
// synchronously on flush. So the FLIP is keyed by the video each node now shows (not by node identity)
// and the survivors must be inverted in the same task as the write, before the browser paints the
// rebound layout. Positions are relative to the shelf's own contents box so a concurrent grid reflow
// moving the whole shelf does not leak into the per-tile deltas.

const SHELF_ITEM_SELECTOR = "ytd-rich-item-renderer";
const SURVIVOR_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
const ENTRANCE_FADE_EASING = "cubic-bezier(0.7, 0, 1, 1)";
const MILLISECONDS_PER_FRAME = 1000 / 60;
const PROMOTION_POLL_FRAMES = 8;
const GLIDE_FRAME_BUFFER = 4;

function nextFrame() {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

function shelfItemId(elItem: HTMLElement) {
  return isPolymerElement(elItem) ? videoIdFromData(elItem.data) : null;
}

// True only when the tile is painted where the user is looking. elementFromPoint respects overflow
// clipping, so a tile tucked in a collapsed shelf's hidden rows - even one whose rect overlaps the
// viewport - is not the element at its own centre and reads as not visible, alongside display:none
// and scrolled-off tiles.
function isVisibleToUser(elItem: HTMLElement) {
  const { left, top, width, height } = elItem.getBoundingClientRect();
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const isCenterOnScreen = centerX >= 0 && centerX < innerWidth && centerY >= 0 && centerY < innerHeight;
  if (width === 0 || height === 0 || !isCenterOnScreen) {
    return false;
  }

  const elAtPoint = document.elementFromPoint(centerX, centerY);
  return !!elAtPoint && elItem.contains(elAtPoint);
}

function shelfItems(elShelf: HTMLElement) {
  return [...elShelf.querySelectorAll<HTMLElement>(SHELF_ITEM_SELECTOR)];
}

function visibleShelfItems(elShelf: HTMLElement) {
  return shelfItems(elShelf).filter(elItem => elItem.offsetWidth > 0);
}

interface RelativePosition {
  left: number;
  top: number;
}

function recordVisiblePositions(elShelf: HTMLElement, elContents: HTMLElement) {
  const positions = new Map<string, RelativePosition>();
  const contentsRect = elContents.getBoundingClientRect();
  for (const elItem of visibleShelfItems(elShelf)) {
    const videoId = shelfItemId(elItem);
    if (videoId) {
      const rect = elItem.getBoundingClientRect();
      positions.set(videoId, {
        left: rect.left - contentsRect.left,
        top: rect.top - contentsRect.top
      });
    }
  }
  return positions;
}

function columnSpacing(positions: Map<string, RelativePosition>) {
  const lefts = [...positions.values()].map(position => position.left).sort((left, right) => left - right);
  for (let i = 1; i < lefts.length; i++) {
    if (lefts[i] - lefts[i - 1] > 1) {
      return lefts[i] - lefts[i - 1];
    }
  }
  return 0;
}

function pinSurvivors(elShelf: HTMLElement, elContents: HTMLElement, beforePositions: Map<string, RelativePosition>) {
  const contentsRect = elContents.getBoundingClientRect();
  const elGliders: HTMLElement[] = [];
  for (const elItem of visibleShelfItems(elShelf)) {
    const videoId = shelfItemId(elItem);
    const before = videoId ? beforePositions.get(videoId) : undefined;
    if (!before) {
      continue;
    }

    const rect = elItem.getBoundingClientRect();
    const deltaX = before.left - (rect.left - contentsRect.left);
    const deltaY = before.top - (rect.top - contentsRect.top);
    if (Math.abs(deltaX) >= 1 || Math.abs(deltaY) >= 1) {
      elItem.style.transition = "none";
      elItem.style.translate = `${deltaX}px ${deltaY}px`;
      elGliders.push(elItem);
    }
  }
  return elGliders;
}

type AnimateShelfRemovalParams = Prettify<{
  elShelf: HTMLElement;
  retained: Prettify<InnerTubeRichGridItem>[];
  removedVideoIds: Set<string>;
}>;

export async function animateShelfRemoval({ elShelf, retained, removedVideoIds }: AnimateShelfRemovalParams) {
  const elContents = elShelf.querySelector<HTMLElement>("#contents");
  if (!isPolymerElement(elShelf) || !elContents) {
    return;
  }

  const elRemovedTiles = shelfItems(elShelf).filter(elItem => {
    const videoId = shelfItemId(elItem);
    return !!videoId && removedVideoIds.has(videoId) && isVisibleToUser(elItem);
  });
  // Only animate when a removed tile is actually on screen. A removal tucked in a collapsed shelf's
  // hidden rows or scrolled out of the viewport has nothing the user can see - apply it instantly.
  if (elRemovedTiles.length === 0) {
    elShelf.set("data.contents", retained);
    return;
  }

  const beforePositions = recordVisiblePositions(elShelf, elContents);
  const slideInDistance = columnSpacing(beforePositions);
  // Pre-hide the overflow so the tile promoted into view starts invisible and does not flash.
  for (const elItem of shelfItems(elShelf).filter(elItem => elItem.offsetWidth === 0)) {
    elItem.style.opacity = "0";
  }

  const ghosts = createRemovalGhosts(elRemovedTiles);

  // Write inside a frame, then invert in the microtask that follows (before the browser paints the
  // rebound layout). A synchronous pin does not establish the transition baseline on Firefox.
  await new Promise<void>(resolve => requestAnimationFrame(() => {
    elShelf.set("data.contents", retained);
    flushPolymerRender();
    resolve();
  }));
  const elGliders = pinSurvivors(elShelf, elContents, beforePositions);

  await nextFrame();
  releaseSurvivors(elGliders);
  dissolveRemovalGhosts(ghosts);
  await glideNewlyVisible(elShelf, beforePositions, slideInDistance);
  await clearHiddenOpacity(elShelf);
}

async function glideNewlyVisible(
  elShelf: HTMLElement,
  beforePositions: Map<string, RelativePosition>,
  slideInDistance: number
) {
  for (let frame = 0; frame < PROMOTION_POLL_FRAMES; frame++) {
    const elPromoted = visibleShelfItems(elShelf).filter(elItem => {
      const videoId = shelfItemId(elItem);
      return !!videoId && !beforePositions.has(videoId);
    });
    if (elPromoted.length > 0) {
      for (const elItem of elPromoted) {
        elItem.style.transition = "none";
        elItem.style.translate = `${slideInDistance || elItem.getBoundingClientRect().width}px 0`;
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
    elItem.style.transition = `translate ${SURVIVOR_SHIFT_MS}ms ${SURVIVOR_EASING}`;
    elItem.style.translate = "";
    elItem.addEventListener("transitionend", () => {
      elItem.style.transition = "";
      elItem.style.translate = "";
    }, { once: true });
  }
}

function releaseEntrants(elEntrants: HTMLElement[]) {
  for (const elItem of elEntrants) {
    elItem.style.transition = `translate ${SURVIVOR_SHIFT_MS}ms ${SURVIVOR_EASING}, `
      + `opacity ${SURVIVOR_SHIFT_MS}ms ${ENTRANCE_FADE_EASING}`;
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
  for (let frame = 0; frame < totalFrames; frame++) {
    await nextFrame();
  }

  for (const elItem of shelfItems(elShelf)) {
    if (elItem.offsetWidth === 0) {
      elItem.style.opacity = "";
    }
  }
}
