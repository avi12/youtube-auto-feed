import type { PolymerElement } from "../types/polymer";

declare global {
  var Polymer: {
    flush?: () => void;
  } | undefined;
}

export function isPolymerElement(element: Element): element is PolymerElement {
  return "data" in element;
}

// Synchronous flush needed inside view-transition callbacks, where rAF stalls until the transition times out.
export function flushPolymerRender() {
  globalThis.Polymer?.flush?.();
}
