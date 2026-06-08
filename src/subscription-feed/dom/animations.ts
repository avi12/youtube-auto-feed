import { isAnimationsEnabled } from "../settings-state";
import type { Prettify } from "../types/prettify";

// Pulse/entrance class triggers and a viewport check. The FLIP reflow, the join-tile scale-in, and
// the leave-tile ghost fade all live in mirror.ts; this module only toggles the ytaf-* classes.

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
