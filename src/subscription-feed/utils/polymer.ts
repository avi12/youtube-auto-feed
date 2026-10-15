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

// YouTube's elements route commands and actions (an update endpoint, an "update title" action) to
// whichever element registered a handler, exactly as when YouTube resolves them from its own responses.
interface CommandResolverElement extends HTMLElement {
  resolveCommand(command: object): unknown;
}

export function isCommandResolver(element: Element): element is CommandResolverElement {
  return "resolveCommand" in element && typeof element.resolveCommand === "function";
}

// YouTube's popup menus: fixed-position overlays aligned to the element that opened them.
export interface IronDropdownElement extends HTMLElement {
  opened: boolean;
  positionTarget: Element | null;
  refit(): void;
  close(): void;
}

export function isIronDropdown(target: EventTarget | undefined): target is IronDropdownElement {
  return target instanceof HTMLElement
    && "positionTarget" in target
    && "refit" in target && typeof target.refit === "function"
    && "close" in target && typeof target.close === "function";
}
