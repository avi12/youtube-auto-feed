import type { Prettify } from "../types/prettify";
import { isPolymerElement } from "../utils/polymer";
import { videoIdFromData } from "../utils/video-id";

// All the view-transition / animation plumbing lives here. The DOM mutation modules (add, remove,
// move, reposition) build up shift/entrance/exit styles using these helpers, then run the actual
// data mutation inside `withViewTransitionLock` so that only one view transition is in flight at
// any time (the document can only host one).

const ANIMATION_DURATION_MS = 380;
const STAGGER_MAX_DELAY_RANGE_MS = 80;
const STAGGER_MAX_DELAY_CAP_MS = 20;
const NEW_ITEM_MAX_DELAY_RANGE_MS = 160;
const NEW_ITEM_MAX_DELAY_CAP_MS = 40;
const WAIT_FOR_FRAMES_MAX = 10;

export function prefersReducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Only one view transition can run at a time per document; serialize callers through this lock.
let viewTransitionLock: Promise<void> = Promise.resolve();

function noop() {}

export async function withViewTransitionLock<T>(work: () => Promise<T> | T): Promise<T> {
  const previous = viewTransitionLock;
  let release: () => void = noop;
  viewTransitionLock = new Promise<void>(resolve => {
    release = resolve;
  });
  try {
    await previous;
    const result = await work();
    return result;
  } finally {
    release();
  }
}

const animationClasses = ["ytsua-new", "ytsua-updated"] as const;
type AnimationClass = typeof animationClasses[number];

type TriggerAnimationParams = Prettify<{
  elTarget: HTMLElement;
  animationClass: AnimationClass;
}>;

export function triggerAnimation({ elTarget, animationClass }: TriggerAnimationParams) {
  if (prefersReducedMotion()) {
    return;
  }

  elTarget.classList.remove(...animationClasses);
  requestAnimationFrame(() => {
    elTarget.classList.add(animationClass);
    elTarget.addEventListener(
      "animationend",
      () => elTarget.classList.remove(animationClass),
      { once: true }
    );
  });
}

export function isInViewport(element: Element) {
  const { bottom, top } = element.getBoundingClientRect();
  return bottom > 0 && top < innerHeight;
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

// View transition names must be unique per document; this helper assigns one to every element
// while de-duplicating shelf duplicates (the same video can render in Latest and a rich shelf).
export function assignItemViewTransitionNames(elItems: Iterable<HTMLElement>) {
  const assignedIds = new Set<string>();
  for (const elItem of elItems) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    const isFirstOccurrence = !!videoId && !assignedIds.has(videoId);
    if (isFirstOccurrence) {
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
  return itemCount > 1 ? Math.min(STAGGER_MAX_DELAY_RANGE_MS / (itemCount - 1), STAGGER_MAX_DELAY_CAP_MS) : 0;
}

type WaitForFramesParams = Prettify<{
  predicate: () => boolean;
  maxFrames?: number;
}>;

export async function waitForFrames({ predicate, maxFrames = WAIT_FOR_FRAMES_MAX }: WaitForFramesParams) {
  for (let i = 0; i < maxFrames && !predicate(); i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}

type ReassignTransitionNamesParams = Prettify<{
  elItems: Iterable<HTMLElement>;
  animateIds: Set<string>;
}>;

export function reassignTransitionNames({ elItems, animateIds }: ReassignTransitionNamesParams) {
  const reassignedIds = new Set<string>();
  for (const elItem of elItems) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    const isAnimatableAndPending = !!videoId && animateIds.has(videoId) && !reassignedIds.has(videoId);
    if (isAnimatableAndPending) {
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

export async function animateItemsOut(elItems: HTMLElement[]) {
  if (elItems.length === 0) {
    return;
  }

  await new Promise<void>(resolve => {
    // Fallback timer in case animationend never fires (e.g. element removed mid-animation).
    const timer = setTimeout(resolve, ANIMATION_DURATION_MS + 50);
    elItems[0].addEventListener("animationend", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    requestAnimationFrame(() => {
      for (const elItem of elItems) {
        elItem.classList.add("ytsua-removing");
      }
    });
  });
}

export function buildNewItemTransitionStyle(elItems: HTMLElement[]) {
  const count = elItems.length;
  const delayPerItemMs = Math.min(NEW_ITEM_MAX_DELAY_RANGE_MS / Math.max(count - 1, 1), NEW_ITEM_MAX_DELAY_CAP_MS);
  let css = "";
  for (let i = 0; i < elItems.length; i++) {
    const { viewTransitionName } = elItems[i].style;
    if (!viewTransitionName) {
      continue;
    }

    const delayMs = Math.round(i * delayPerItemMs);
    css += `::view-transition-group(${viewTransitionName}){animation-duration:0s}\n`;
    css += `::view-transition-new(${viewTransitionName}){animation:ytsua-slide-in ${ANIMATION_DURATION_MS}ms cubic-bezier(0.2,0,0,1) ${delayMs}ms both}\n`;
  }
  const elStyle = document.createElement("style");
  elStyle.textContent = css;
  return elStyle;
}

type BuildShiftTransitionStyleParams = Prettify<{
  elItems: Iterable<HTMLElement>;
  excludeNames?: Set<string>;
  delayPerItemMs?: number;
}>;

export function buildShiftTransitionStyle({
  elItems,
  excludeNames = new Set<string>(),
  delayPerItemMs = 0
}: BuildShiftTransitionStyleParams) {
  let iItem = 0;
  let css = "";
  for (const elItem of elItems) {
    const { viewTransitionName } = elItem.style;
    const isShiftable = !!viewTransitionName && !excludeNames.has(viewTransitionName);
    if (isShiftable) {
      css += `::view-transition-old(${viewTransitionName}){animation:none;opacity:0}\n`;
      css += `::view-transition-new(${viewTransitionName}){animation:none;opacity:1}\n`;
      const delayMs = Math.round(iItem * delayPerItemMs);
      css += `::view-transition-group(${viewTransitionName}){animation-duration:${ANIMATION_DURATION_MS}ms;animation-timing-function:cubic-bezier(0.4,0,0.2,1);animation-fill-mode:both${delayMs > 0 ? `;animation-delay:${delayMs}ms` : ""}}\n`;
    }

    iItem++;
  }
  const elStyle = document.createElement("style");
  elStyle.textContent = css;
  return elStyle;
}
