import { isPolymerElement, videoIdFromData } from "./helpers";

export const animationClasses = ["ytsua-new", "ytsua-updated"] as const;
export type AnimationClass = typeof animationClasses[number];

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

export function buildStaggerStyle(elItems: Iterable<HTMLElement>, delayPerItemMs = 35) {
  let iItem = 0;
  let css = "";
  for (const elItem of elItems) {
    const { viewTransitionName } = elItem.style;
    if (viewTransitionName) {
      css += `::view-transition-group(${viewTransitionName}){animation-delay:${iItem * delayPerItemMs}ms}\n`;
    }

    iItem++;
  }

  const elStyle = document.createElement("style");
  elStyle.textContent = css;
  return elStyle;
}
