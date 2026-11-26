import { isHtmlElement } from "@/shared/dom-guards";
import { z } from "@/shared/zod";
import { createGuard, METHOD_SCHEMA } from "@/shared/zod-guard";
import type { PolymerElement } from "@/subscription-feed/types/polymer";

declare global {
  var Polymer:
    | {
        flush?: () => void;
      }
    | undefined;
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

const isCommandResolverShape = createGuard(z.looseObject({ resolveCommand: METHOD_SCHEMA }));

export function isCommandResolver(element: Element): element is CommandResolverElement {
  return isCommandResolverShape(element);
}

// YouTube's popup menus: fixed-position overlays aligned to the element that opened them.
export interface IronDropdownElement extends HTMLElement {
  opened: boolean;
  positionTarget: Element | null;
  refit(): void;
  close(): void;
}

const isIronDropdownShape = createGuard(
  z.looseObject({
    refit: METHOD_SCHEMA,
    close: METHOD_SCHEMA
  })
);

export function isIronDropdown(target: EventTarget | undefined): target is IronDropdownElement {
  return isHtmlElement(target) && isIronDropdownShape(target);
}
