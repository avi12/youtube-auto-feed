import type { Prettify } from "../../types/prettify";
import type { VideoSnapshot } from "../../types/video";
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

export function applyLockupTextChanges({ refs, fresh }: Prettify<LockupTextChange>) {
  const { elTitle, elHeading, elTitleLink, elView, elTime } = refs;
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

  setNodeTextIfChanged({
    elNode: elView,
    newText: fresh.viewCountText
  });
  setNodeTextIfChanged({
    elNode: elTime,
    newText: fresh.publishedTimeText
  });
}

export function changingLockupTextElements({ refs, fresh }: Prettify<LockupTextChange>) {
  const elements: HTMLElement[] = [];
  const { elTitle, elView, elTime } = refs;
  const isTitleChanging = !!elTitle && elTitle.textContent !== fresh.title && fresh.title !== "";
  if (isTitleChanging) {
    elements.push(elTitle);
  }

  const isViewChanging = !!elView && elView.textContent !== fresh.viewCountText;
  if (isViewChanging) {
    elements.push(elView);
  }

  const isTimeChanging = !!elTime && elTime.textContent !== fresh.publishedTimeText;
  if (isTimeChanging) {
    elements.push(elTime);
  }

  return elements;
}
