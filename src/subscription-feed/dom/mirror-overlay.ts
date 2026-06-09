import { thumbnailImgsInItem } from "./mirror-elements";

export function dropOverlayWhenThumbnailLoads(elItem: HTMLElement, elOverlay: HTMLElement | null) {
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

// Isolated stacking context so z-index:-1 overlays stay behind this tile, not behind its neighbours.
export function prepareCoverHost(elItem: HTMLElement) {
  if (getComputedStyle(elItem).position === "static") {
    elItem.style.position = "relative";
  }

  elItem.style.isolation = "isolate";
  elItem.dataset.ytafCoverHost = "1";
}

export function addCoverOverlay(elItem: HTMLElement, url: string, rect: DOMRect, tileRect: DOMRect, radius: string) {
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

export function clearReflowImageCovers() {
  for (const elOverlay of document.querySelectorAll("[data-ytaf-cover-overlay]")) {
    elOverlay.remove();
  }

  for (const elItem of document.querySelectorAll<HTMLElement>("[data-ytaf-cover-host]")) {
    elItem.style.position = "";
    elItem.style.isolation = "";
    elItem.style.zIndex = "";
    delete elItem.dataset.ytafCoverHost;
  }
}
