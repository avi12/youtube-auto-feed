import type { Prettify } from "../../types/prettify";
import { withViewTransitionLock } from "../animations";

// "Dissolve" = a brief crossfade view transition wrapped around any DOM mutation. Used so a
// metadata edit (title/view count/thumbnail) animates in instead of snapping. Each call gets a
// unique transition id so transition names don't collide between concurrent dissolves.

let transitionCounter = 0;

interface NamedElement {
  elTarget: HTMLElement;
  previousName: string;
}

type ApplyWithDissolveParams = Prettify<{
  elements: HTMLElement[];
  apply: () => void;
}>;

export async function applyWithDissolve({ elements, apply }: ApplyWithDissolveParams) {
  const isViewTransitionAvailable = elements.length > 0 && "startViewTransition" in document;
  if (!isViewTransitionAvailable) {
    apply();
    return;
  }

  await withViewTransitionLock(async () => {
    transitionCounter++;
    const transitionId = transitionCounter;
    const named: Prettify<NamedElement>[] = elements.map((elTarget, iElement) => {
      const previousName = elTarget.style.viewTransitionName;
      elTarget.style.viewTransitionName = `ytsua-${transitionId}-${iElement}`;
      return {
        elTarget,
        previousName
      };
    });

    function restoreNames() {
      for (const { elTarget, previousName } of named) {
        if (elTarget.style.viewTransitionName.startsWith(`ytsua-${transitionId}-`)) {
          elTarget.style.viewTransitionName = previousName;
        }
      }
    }

    try {
      await document.startViewTransition(apply).finished;
    } finally {
      restoreNames();
    }
  });
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
