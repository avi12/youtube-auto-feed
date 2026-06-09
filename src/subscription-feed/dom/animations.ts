import { isAnimationsEnabled } from "../settings-state";
import type { Prettify } from "../types/prettify";

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
