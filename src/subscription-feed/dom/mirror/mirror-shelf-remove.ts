import type { InnerTubeRichGridItem } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";
import { flushPolymerRender, isPolymerElement } from "../../utils/polymer";
import { videoIdFromData } from "../../utils/video-id";
import { SURVIVOR_SHIFT_MS } from "./mirror-constants";
import { createRemovalGhosts, dissolveRemovalGhosts } from "./mirror-ghosts";

// Animated removal inside a rich shelf. An expanded shelf reflows like the Latest band - survivors
// glide to their new slots, wrapping rows. A collapsed shelf shows one row and hides the overflow with
// display:none, so a removed visible tile leaves a gap: the survivors slide left to fill it and the
// first previously-hidden tile (now promoted into the last slot) fades in while sliding from the right.
// Positions are measured relative to the shelf's own contents box so a concurrent grid reflow moving
// the whole shelf does not leak into the per-tile deltas.

const SHELF_ITEM_SELECTOR = "ytd-rich-item-renderer";
const SURVIVOR_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
const ENTRANCE_EASING = "cubic-bezier(0.05, 0.7, 0.1, 1)";
const MILLISECONDS_PER_FRAME = 1000 / 60;
const REBIND_FRAMES = 3;
const GLIDE_FRAME_BUFFER = 4;

function nextFrame() {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

function shelfItemId(elItem: HTMLElement) {
  return isPolymerElement(elItem) ? videoIdFromData(elItem.data) : null;
}

function visibleShelfItems(elShelf: HTMLElement) {
  return [...elShelf.querySelectorAll<HTMLElement>(SHELF_ITEM_SELECTOR)].filter(elItem => elItem.offsetWidth > 0);
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

  const beforePositions = recordVisiblePositions(elShelf, elContents);
  const slideInDistance = columnSpacing(beforePositions);
  const elRemovedTiles = visibleShelfItems(elShelf).filter(elItem => {
    const videoId = shelfItemId(elItem);
    return !!videoId && removedVideoIds.has(videoId);
  });
  const ghosts = createRemovalGhosts(elRemovedTiles);

  elShelf.set("data.contents", retained);
  flushPolymerRender();
  for (let frame = 0; frame < REBIND_FRAMES; frame++) {
    await nextFrame();
  }

  const contentsRect = elContents.getBoundingClientRect();
  const elGliders: HTMLElement[] = [];
  for (const elItem of visibleShelfItems(elShelf)) {
    const videoId = shelfItemId(elItem);
    if (!videoId) {
      continue;
    }

    elItem.style.transition = "none";
    elItem.style.translate = "";
    elItem.style.opacity = "";
    const rect = elItem.getBoundingClientRect();
    const before = beforePositions.get(videoId);
    if (!before) {
      elItem.style.translate = `${slideInDistance || rect.width}px 0`;
      elItem.style.opacity = "0";
      elGliders.push(elItem);
      continue;
    }

    const deltaX = before.left - (rect.left - contentsRect.left);
    const deltaY = before.top - (rect.top - contentsRect.top);
    if (Math.abs(deltaX) >= 1 || Math.abs(deltaY) >= 1) {
      elItem.style.translate = `${deltaX}px ${deltaY}px`;
      elGliders.push(elItem);
    }
  }

  await nextFrame();
  releaseShelfGliders(elGliders);
  dissolveRemovalGhosts(ghosts);

  const animationFrames = Math.ceil(SURVIVOR_SHIFT_MS / MILLISECONDS_PER_FRAME) + GLIDE_FRAME_BUFFER;
  for (let frame = 0; frame < animationFrames; frame++) {
    await nextFrame();
  }
}

function releaseShelfGliders(elGliders: HTMLElement[]) {
  for (const elItem of elGliders) {
    elItem.style.transition =
      `translate ${SURVIVOR_SHIFT_MS}ms ${SURVIVOR_EASING}, opacity ${SURVIVOR_SHIFT_MS}ms ${ENTRANCE_EASING}`;
    elItem.style.translate = "";
    elItem.style.opacity = "";
    elItem.addEventListener("transitionend", () => {
      elItem.style.transition = "";
      elItem.style.translate = "";
      elItem.style.opacity = "";
    }, { once: true });
  }
}
