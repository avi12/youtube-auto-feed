import type { Prettify } from "@/subscription-feed/types/prettify";
import type { VideoSnapshot } from "@/subscription-feed/types/video";

import { setAttributeIfChanged, setNodeTextIfChanged } from "./dissolve";
import type { LockupTextElements } from "./text-fields-lockup-elements";

type BuildAriaLabelUpdateParams = Prettify<{
  elTitleLink: HTMLAnchorElement | null;
  existingTitle: string;
  newTitle: string;
}>;

function buildAriaLabelUpdate({ elTitleLink, existingTitle, newTitle }: BuildAriaLabelUpdateParams) {
  const isTitleUpdatable = !!elTitleLink && !!newTitle && !!existingTitle && existingTitle !== newTitle;
  if (!isTitleUpdatable) {
    return null;
  }

  const existingAriaLabel = elTitleLink.getAttribute("aria-label");
  // aria-label is "{title} by {channel} {views} {time}"; only patch when the prefix matches the old title.
  const isAriaLabelPatchable = existingAriaLabel !== null && existingAriaLabel.startsWith(existingTitle);
  if (!isAriaLabelPatchable) {
    return null;
  }

  return `${newTitle}${existingAriaLabel.slice(existingTitle.length)}`;
}

interface LockupTextChange {
  refs: LockupTextElements;
  fresh: VideoSnapshot;
}

// The painted spans mirror the parts one to one, so part N is written into span N without knowing
// what it says. A different count means YouTube changed the layout, which only a re-render can follow.
export function isLockupMetadataShapeMatching({ refs, fresh }: Prettify<LockupTextChange>) {
  return refs.elMetadataParts.length === fresh.metadataParts.length;
}

function pairMetadataParts({ refs, fresh }: Prettify<LockupTextChange>) {
  if (
    !isLockupMetadataShapeMatching({
      refs,
      fresh
    })
  ) {
    return [];
  }

  return refs.elMetadataParts.flatMap((elPart, i) => {
    const part = fresh.metadataParts[i];
    return part
      ? [
          {
            elPart,
            part
          }
        ]
      : [];
  });
}

// A part's text sits in its innermost element; a channel byline nests it in a link that must survive.
function innermostElement(elNode: Element): Element {
  const elOnlyChild = elNode.childElementCount === 1 ? elNode.firstElementChild : null;
  return elOnlyChild ? innermostElement(elOnlyChild) : elNode;
}

export function applyLockupTextChanges({ refs, fresh }: Prettify<LockupTextChange>) {
  const { elTitle, elHeading, elTitleLink } = refs;
  const existingTitle = elTitle?.textContent ?? "";
  setNodeTextIfChanged({
    elNode: elTitle,
    newText: fresh.title
  });
  setAttributeIfChanged({
    elNode: elHeading,
    name: "title",
    value: fresh.title
  });
  const newAriaLabel = buildAriaLabelUpdate({
    elTitleLink,
    existingTitle,
    newTitle: fresh.title
  });
  if (newAriaLabel !== null) {
    elTitleLink?.setAttribute("aria-label", newAriaLabel);
  }

  for (const { elPart, part } of pairMetadataParts({
    refs,
    fresh
  })) {
    setNodeTextIfChanged({
      elNode: innermostElement(elPart),
      newText: part.text
    });
    setAttributeIfChanged({
      elNode: elPart,
      name: "aria-label",
      value: part.accessibilityLabel
    });
  }
}

export function changingLockupTextElements({ refs, fresh }: Prettify<LockupTextChange>) {
  const elements: HTMLElement[] = [];
  const { elTitle } = refs;
  const isTitleChanging = !!elTitle && elTitle.textContent !== fresh.title && fresh.title !== "";
  if (isTitleChanging) {
    elements.push(elTitle);
  }

  for (const { elPart, part } of pairMetadataParts({
    refs,
    fresh
  })) {
    if (innermostElement(elPart).textContent !== part.text) {
      elements.push(elPart);
    }
  }

  return elements;
}
