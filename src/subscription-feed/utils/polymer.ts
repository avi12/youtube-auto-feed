import type { PolymerElement } from "../types/polymer";

declare global {
  var Polymer: {
    flush?: () => void;
  } | undefined;
}

// YouTube's custom elements all expose a `data` property bound to their Polymer template.
// The presence of `data` is what differentiates a hydrated Polymer element from a bare HTMLElement.
export function isPolymerElement(element: Element): element is PolymerElement {
  return "data" in element;
}

// Synchronously flush Polymer's pending property effects and dom-repeat renders. dom-repeat rebinds
// asynchronously after `set`, so a caller that needs the new node-to-data binding applied right now
// (e.g. inside a view-transition update callback, where requestAnimationFrame stalls until the
// transition times out) calls this to apply the rebind in the same tick instead of waiting on a frame.
export function flushPolymerRender() {
  globalThis.Polymer?.flush?.();
}
