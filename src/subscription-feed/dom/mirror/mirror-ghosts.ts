import { SURVIVOR_SHIFT_MS } from "./mirror-constants";
import { REMOVAL_GHOST_ATTR, positionRemovalGhost } from "./mirror-ghost-position";
import { paintGhostThumbnailBackground, thumbnailGhost } from "./mirror-ghost-thumbnails";

// A leaving tile's node is reused by Polymer the instant the shorter contents are written, so instead
// of animating it out we clone a fixed-position snapshot ("ghost") that survives the write and dissolves
// in place. Cloning the view-model keeps thumbnail and metadata together; a legacy renderer that can't
// be cloned falls back to a thumbnail-only ghost.
const GHOST_CLONEABLE_SELECTOR =
  "yt-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model";

export function createRemovalGhosts(elRemovedTiles: HTMLElement[]) {
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

function cloneTileGhost(elTile: HTMLElement) {
  const elContent = elTile.querySelector<HTMLElement>(GHOST_CLONEABLE_SELECTOR);
  if (!elContent) {
    return null;
  }

  const rect = elContent.getBoundingClientRect();
  if (rect.width === 0) {
    return null;
  }

  const elGhost = elContent.cloneNode(true);
  if (!(elGhost instanceof HTMLElement)) {
    return null;
  }

  positionRemovalGhost({
    elGhost,
    rect
  });
  paintGhostThumbnailBackground({
    elTile,
    elGhost
  });
  return elGhost;
}

export function dissolveRemovalGhosts(ghosts: HTMLElement[]) {
  // Dissolve over the survivor glide with the same easing, so the ghost keeps covering the vacated
  // slot until the neighbour slides into it - a shorter/faster fade leaves a one-frame empty flash.
  const dissolveCurve = `${SURVIVOR_SHIFT_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
  for (const elGhost of ghosts) {
    elGhost.style.transition = `opacity ${dissolveCurve}, scale ${dissolveCurve}`;
    elGhost.style.opacity = "0";
    elGhost.style.scale = "0.85";
    elGhost.addEventListener("transitionend", () => elGhost.remove(), { once: true });
  }
}

export function clearRemovalGhosts() {
  for (const elGhost of document.querySelectorAll(`[${REMOVAL_GHOST_ATTR}]`)) {
    elGhost.remove();
  }
}
