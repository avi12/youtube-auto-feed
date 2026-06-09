import type { Prettify } from "../../types/prettify";
import { triggerAnimation } from "../animations";

// Per-element pulse instead of a document-level view transition: a page-wide transition leaves every
// tile un-hittable for its duration (elementFromPoint falls through to <html>), and these edits fire
// constantly as tiles scroll in, so serialized transitions would chain into seconds of dead grid.

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
