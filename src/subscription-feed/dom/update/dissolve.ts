import type { Prettify } from "../../types/prettify";
import { triggerAnimation } from "../animations";

// "Dissolve" = apply a metadata edit (title/view count/thumbnail) in place and animate it with a
// short element-scoped pulse so it eases in instead of snapping. This deliberately avoids a
// document-level view transition: that captures the whole document and leaves every tile
// un-hittable (elementFromPoint falls through to <html>) for the transition's duration, and these
// per-tile edits fire constantly as tiles scroll into view - the serialized transitions chain into
// seconds where the grid cannot be hovered or clicked. A per-element animation keeps the page live.

type ApplyWithDissolveParams = Prettify<{
  elements: HTMLElement[];
  apply: () => void;
}>;

export function applyWithDissolve({ elements, apply }: ApplyWithDissolveParams) {
  apply();
  for (const elTarget of elements) {
    triggerAnimation({
      elTarget,
      animationClass: "ytsua-updated"
    });
  }
}

// Tiny utilities used by text-fields. Pulled out so they're easy to find when reading.

type SetNodeTextIfChangedParams = Prettify<{
  elNode: Element | null;
  newText: string;
}>;

export function setNodeTextIfChanged({ elNode, newText }: SetNodeTextIfChangedParams) {
  const isUpdateNeeded = elNode !== null && elNode.textContent !== newText;
  if (!isUpdateNeeded) {
    return;
  }

  elNode.textContent = newText;
}

type SetAttributeIfChangedParams = Prettify<{
  elNode: Element | null;
  name: string;
  value: string;
}>;

export function setAttributeIfChanged({ elNode, name, value }: SetAttributeIfChangedParams) {
  const isUpdateNeeded = elNode !== null && value !== "" && elNode.getAttribute(name) !== value;
  if (!isUpdateNeeded) {
    return;
  }

  elNode.setAttribute(name, value);
}
