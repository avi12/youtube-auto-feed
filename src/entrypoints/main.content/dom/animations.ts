import { isPolymerElement, videoIdFromData } from "../helpers";

const animationClasses = ["ytsua-new", "ytsua-updated"] as const;
type AnimationClass = typeof animationClasses[number];

export function triggerAnimation(elTarget: HTMLElement, animationClass: AnimationClass) {
  elTarget.classList.remove(...animationClasses);
  void elTarget.offsetWidth;
  elTarget.classList.add(animationClass);
  elTarget.addEventListener(
    "animationend",
    () => elTarget.classList.remove(animationClass),
    { once: true }
  );
}

export function isInViewport(element: Element) {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < innerHeight;
}

export function filterToViewport(elItems: Iterable<HTMLElement>) {
  const result: HTMLElement[] = [];
  for (const elItem of elItems) {
    if (isInViewport(elItem)) {
      result.push(elItem);
    }
  }
  return result;
}

export function assignItemViewTransitionNames(elItems: Iterable<HTMLElement>) {
  const assignedIds = new Set<string>();
  for (const elItem of elItems) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (videoId && !assignedIds.has(videoId)) {
      assignedIds.add(videoId);
      elItem.style.viewTransitionName = `ytsua-item-${videoId}`;
    }
  }
}

export function clearItemViewTransitionNames(elItems: Iterable<HTMLElement>) {
  for (const elItem of elItems) {
    elItem.style.viewTransitionName = "";
  }
}

export function extractAnimateIds(elItems: Iterable<HTMLElement>) {
  const ids = new Set<string>();
  for (const elItem of elItems) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (videoId) {
      ids.add(videoId);
    }
  }
  return ids;
}

export function calculateStaggerDelayMs(itemCount: number) {
  return itemCount > 1 ? Math.min(80 / (itemCount - 1), 20) : 0;
}

export async function waitForFrames(predicate: () => boolean, maxFrames = 10) {
  for (let i = 0; i < maxFrames && !predicate(); i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}

export function reassignTransitionNames(elItems: Iterable<HTMLElement>, animateIds: Set<string>) {
  const reassignedIds = new Set<string>();
  for (const elItem of elItems) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (videoId && animateIds.has(videoId) && !reassignedIds.has(videoId)) {
      reassignedIds.add(videoId);
      elItem.style.viewTransitionName = `ytsua-item-${videoId}`;
    }
  }
}

export function clearAllItemViewTransitionNames() {
  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer, ytd-grid-video-renderer")) {
    if (elItem.style.viewTransitionName) {
      elItem.style.viewTransitionName = "";
    }
  }
}

export function buildRemoveTransitionStyle(elItems: Iterable<HTMLElement>) {
  let css = "";
  for (const elItem of elItems) {
    const { viewTransitionName } = elItem.style;
    if (viewTransitionName) {
      css += `::view-transition-group(${viewTransitionName}){animation:none}\n`;
      css += `::view-transition-old(${viewTransitionName}){animation:ytsua-slide-out 380ms cubic-bezier(0.2,0,0,1) both}\n`;
    }
  }
  const elStyle = document.createElement("style");
  elStyle.textContent = css;
  return elStyle;
}

export function buildNewItemTransitionStyle(elItems: HTMLElement[]) {
  const count = elItems.length;
  const delayPerItemMs = Math.min(160 / Math.max(count - 1, 1), 40);
  let css = "";
  for (let i = 0; i < elItems.length; i++) {
    const { viewTransitionName } = elItems[i].style;
    if (!viewTransitionName) {
      continue;
    }

    const delayMs = Math.round(i * delayPerItemMs);
    css += `::view-transition-group(${viewTransitionName}){animation-duration:0s}\n`;
    css += `::view-transition-new(${viewTransitionName}){animation:ytsua-slide-in 380ms cubic-bezier(0.2,0,0,1) ${delayMs}ms both}\n`;
  }
  const elStyle = document.createElement("style");
  elStyle.textContent = css;
  return elStyle;
}

export function buildShiftTransitionStyle(
  elItems: Iterable<HTMLElement>,
  excludeNames = new Set<string>(),
  delayPerItemMs = 0
) {
  let iItem = 0;
  let css = "";
  for (const elItem of elItems) {
    const { viewTransitionName } = elItem.style;
    if (viewTransitionName && !excludeNames.has(viewTransitionName)) {
      css += `::view-transition-old(${viewTransitionName}){animation:none;opacity:0}\n`;
      css += `::view-transition-new(${viewTransitionName}){animation:none;opacity:1}\n`;
      const delayMs = Math.round(iItem * delayPerItemMs);
      css += `::view-transition-group(${viewTransitionName}){animation-duration:380ms;animation-timing-function:cubic-bezier(0.4,0,0.2,1);animation-fill-mode:both${delayMs > 0 ? `;animation-delay:${delayMs}ms` : ""}}\n`;
    }

    iItem++;
  }
  const elStyle = document.createElement("style");
  elStyle.textContent = css;
  return elStyle;
}
