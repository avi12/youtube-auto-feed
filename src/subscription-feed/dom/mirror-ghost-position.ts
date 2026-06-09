export const REMOVAL_GHOST_ATTR = "data-ytaf-removal-ghost";

export function positionRemovalGhost(elGhost: HTMLElement, rect: DOMRect) {
  elGhost.setAttribute(REMOVAL_GHOST_ATTR, "1");
  const { style } = elGhost;
  style.position = "fixed";
  style.left = `${rect.left}px`;
  style.top = `${rect.top}px`;
  style.width = `${rect.width}px`;
  style.height = `${rect.height}px`;
  style.margin = "0";
  style.zIndex = "2000";
  style.pointerEvents = "none";
}
