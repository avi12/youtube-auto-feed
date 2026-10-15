import type { Prettify } from "../../types/prettify";
import { SURVIVOR_GLIDE_EASING, SURVIVOR_SHIFT_MS } from "./mirror-constants";

const MIN_GLIDE_PX = 1;
const GLIDE_PROPERTY = "translate";

type PinAtOffsetParams = Prettify<{
  elGlider: HTMLElement;
  deltaX: number;
  deltaY: number;
}>;

// Stands an element that a reflow just moved back where it stood before, so it can glide to its new
// place. Returns whether it moved at all.
export function pinAtOffset({ elGlider, deltaX, deltaY }: PinAtOffsetParams) {
  const isMoved = Math.abs(deltaX) >= MIN_GLIDE_PX || Math.abs(deltaY) >= MIN_GLIDE_PX;
  if (isMoved) {
    elGlider.style.transition = "none";
    elGlider.style.translate = `${deltaX}px ${deltaY}px`;
  }

  return isMoved;
}

type ClearTransitionParams = Prettify<{
  elGlider: HTMLElement;
  glide: symbol;
}>;

// Read through the document: YouTube's Web Animations polyfill replaces Element.getAnimations (and the
// Animation globals), which then never report a CSS transition. A hover fade inside the element is not its own.
function ownGlides(elGlider: Element) {
  return document.getAnimations().filter(animation => {
    const { effect } = animation;
    const target = effect && "target" in effect ? effect.target : null;
    return target === elGlider
      && "transitionProperty" in animation
      && animation.transitionProperty === GLIDE_PROPERTY;
  });
}

export function isInGlide(elGlider: HTMLElement) {
  return elGlider.style.translate !== "" || ownGlides(elGlider).length > 0;
}

// Settles to whether the glide reached its end; a newer pin cancels it.
export async function waitForGlide(elGlider: Element) {
  const glides = ownGlides(elGlider);
  return Promise.all(glides.map(glide => glide.finished)).then(() => true, () => false);
}

const latestGlides = new WeakMap<HTMLElement, symbol>();

// Cleared even when the glide is cut short (a closed menu hides mid-glide): the element is left clean at
// rest, unless a newer pin or glide has taken it over.
async function clearTransitionOnceGlided({ elGlider, glide }: ClearTransitionParams) {
  await waitForGlide(elGlider);
  const isLatestGlide = latestGlides.get(elGlider) === glide && elGlider.style.translate === "";
  if (isLatestGlide) {
    elGlider.style.transition = "";
  }
}

export function glideToRest(elGlider: HTMLElement) {
  const glide = Symbol(GLIDE_PROPERTY);
  latestGlides.set(elGlider, glide);
  elGlider.style.transition = `${GLIDE_PROPERTY} ${SURVIVOR_SHIFT_MS}ms ${SURVIVOR_GLIDE_EASING}`;
  elGlider.style.translate = "";
  clearTransitionOnceGlided({
    elGlider,
    glide
  }).catch(() => {});
}
