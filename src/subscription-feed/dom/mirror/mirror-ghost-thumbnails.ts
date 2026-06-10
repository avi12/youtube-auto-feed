import { thumbnailContainerInItem, thumbnailImgsInItem } from "./mirror-elements";
import { positionRemovalGhost } from "./mirror-ghost-position";

function thumbnailUrlInItem(elTile: HTMLElement) {
  return thumbnailImgsInItem(elTile).map(elImg => elImg.currentSrc || elImg.src).find(Boolean);
}

export function thumbnailGhost(elTile: HTMLElement) {
  const elThumb = thumbnailContainerInItem(elTile);
  const url = thumbnailUrlInItem(elTile);
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

// The cloned <img> re-decodes from cache, so hold its already-painted picture as a background.
export function paintGhostThumbnailBackground(elTile: HTMLElement, elGhost: HTMLElement) {
  const url = thumbnailUrlInItem(elTile);
  if (!url) {
    return;
  }

  for (const elImg of elGhost.querySelectorAll<HTMLImageElement>("yt-thumbnail-view-model img")) {
    elImg.style.backgroundImage = `url("${url}")`;
    elImg.style.backgroundSize = "cover";
    elImg.style.backgroundPosition = "center";
  }
}
