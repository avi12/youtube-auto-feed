import type { PolymerElement } from "../types/polymer";

declare global {
  var Polymer: {
    flush?: () => void;
  } | undefined;
}

// A hydrated Polymer element has a `data` property; a bare HTMLElement does not.
export function isPolymerElement(element: Element): element is PolymerElement {
  return "data" in element;
}

// Flushes Polymer's pending property effects and dom-repeat rebinds synchronously.
// Needed inside view-transition update callbacks where rAF stalls until the transition times out.
export function flushPolymerRender() {
  globalThis.Polymer?.flush?.();
}
