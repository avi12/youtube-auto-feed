import { isAnimationsEnabled } from "../settings-state";
import type { Prettify } from "../types/prettify";

// Animation helpers for the feed: the entrance/exit CSS-class triggers and a viewport check. The
// FLIP/cover reflow itself lives in mirror.ts; this module only toggles the ytaf-* animation classes.

const ANIMATION_DURATION_MS = 380;

const animationClasses = ["ytaf-new", "ytaf-updated"] as const;
type AnimationClass = typeof animationClasses[number];

type TriggerAnimationParams = Prettify<{
  elTarget: HTMLElement;
  animationClass: AnimationClass;
}>;

export function triggerAnimation({ elTarget, animationClass }: TriggerAnimationParams) {
  if (!isAnimationsEnabled()) {
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
        elItem.classList.add("ytaf-removing");
      }
    });
  });
}
