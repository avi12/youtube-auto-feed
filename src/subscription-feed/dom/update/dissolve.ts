import type { Prettify } from "../../types/prettify";
import { triggerAnimation } from "../animations";

// "Dissolve" = apply a metadata edit in place with a short per-element pulse so it eases in.
// Avoids a document-level view transition, which leaves every tile un-hittable for its duration
// (elementFromPoint falls through to <html>). These edits fire constantly as tiles scroll into view;
// serialized transitions would chain into seconds of an un-hoverable grid. Per-element keeps the
// page live.

type ApplyWithDissolveParams = Prettify<{
  elements: HTMLElement[];
  apply: () => void;
}>;

export function applyWithDissolve({ elements, apply }: ApplyWithDissolveParams) {
  apply();
  for (const elTarget of elements) {
    triggerAnimation({
      elTarget,
      animationClass: "ytaf-updated"
    });
  }
}

// Utilities used by text-fields.

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
