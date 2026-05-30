import type { PolymerElement } from "../types/polymer";

// YouTube's custom elements all expose a `data` property bound to their Polymer template.
// The presence of `data` is what differentiates a hydrated Polymer element from a bare HTMLElement.
export function isPolymerElement(element: Element): element is PolymerElement {
  return "data" in element;
}
