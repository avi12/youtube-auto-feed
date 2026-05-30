import type { Prettify } from "../../types/prettify";
import type { VideoSnapshot } from "../../types/video";
import { setAttributeIfChanged, setNodeTextIfChanged } from "./dissolve";

// In-place text edits for the three rendering shapes YouTube emits:
//  - "lockup" - new lockupViewModel UI
//  - "shorts" - shorts shelf lockup
//  - "legacy" - old videoRenderer markup (#video-title + #metadata-line)
// Each shape has a pair of functions: `update*` actually writes the text, and `changing*` returns
// the list of elements whose text would change (so the dissolve wrapper knows what to animate).

const TITLE_SELECTOR_LOCKUP = ".ytLockupMetadataViewModelTitle span.ytAttributedStringHost";
const TITLE_HEADING_SELECTOR_LOCKUP = ".ytLockupMetadataViewModelHeadingReset";
const TITLE_LINK_SELECTOR_LOCKUP = "a.ytLockupMetadataViewModelTitle";
const METADATA_ROW_SELECTOR_LOCKUP = ".ytContentMetadataViewModelMetadataRow";
const METADATA_TEXT_SELECTOR_LOCKUP = ":scope > span.ytContentMetadataViewModelMetadataText";
const METADATA_DELIMITER_SELECTOR_LOCKUP = ".ytContentMetadataViewModelDelimiter";
const TITLE_SELECTOR_SHORTS = ".shortsLockupViewModelHostMetadataTitle .ytAttributedStringHost";
const TITLE_LINK_SELECTOR_SHORTS = "a.shortsLockupViewModelHostOutsideMetadataEndpoint";
const SUBHEAD_SELECTOR_SHORTS = ".shortsLockupViewModelHostOutsideMetadataSubhead .ytAttributedStringHost";
const LEGACY_TITLE_SELECTOR = "#video-title yt-formatted-string, #video-title-link yt-formatted-string, #video-title";

export interface LockupTextElements {
  elTitle: HTMLElement | null;
  elHeading: HTMLElement | null;
  elTitleLink: HTMLAnchorElement | null;
  elView: HTMLElement | null;
  elTime: HTMLElement | null;
}

export function collectLockupTextElements(elLockup: HTMLElement): Prettify<LockupTextElements> {
  const elTitle = elLockup.querySelector<HTMLElement>(TITLE_SELECTOR_LOCKUP);
  const elHeading = elLockup.querySelector<HTMLElement>(TITLE_HEADING_SELECTOR_LOCKUP);
  const elTitleLink = elLockup.querySelector<HTMLAnchorElement>(TITLE_LINK_SELECTOR_LOCKUP);
  const elRows = elLockup.querySelectorAll<HTMLElement>(METADATA_ROW_SELECTOR_LOCKUP);
  const elViewTimeRow = Array.from(elRows).find(elRow => elRow.querySelector(METADATA_DELIMITER_SELECTOR_LOCKUP))
    ?? elRows[elRows.length - 1]
    ?? null;
  const elTextSpans = elViewTimeRow
    ? elViewTimeRow.querySelectorAll<HTMLElement>(METADATA_TEXT_SELECTOR_LOCKUP)
    : null;
  return {
    elTitle,
    elHeading,
    elTitleLink,
    elView: elTextSpans?.[0] ?? null,
    elTime: elTextSpans?.[1] ?? null
  };
}

function buildAriaLabelUpdate({ elTitleLink, existingTitle, newTitle }: {
  elTitleLink: HTMLAnchorElement | null;
  existingTitle: string;
  newTitle: string;
}) {
  const isNoOp = !elTitleLink || !newTitle || !existingTitle || existingTitle === newTitle;
  if (isNoOp) {
    return null;
  }

  const existingAriaLabel = elTitleLink.getAttribute("aria-label");
  // Aria-label is "{title} by {channel} {views} {time}"; only patch when prefix matches the prior title.
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

interface ItemTextChange {
  elItem: HTMLElement;
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

export function updateShortsTextFields({ elItem, fresh }: Prettify<ItemTextChange>) {
  setNodeTextIfChanged({
    elNode: elItem.querySelector(TITLE_SELECTOR_SHORTS),
    newText: fresh.title
  });
  setAttributeIfChanged({
    elNode: elItem.querySelector(TITLE_LINK_SELECTOR_SHORTS),
    name: "title",
    value: fresh.title
  });
  setNodeTextIfChanged({
    elNode: elItem.querySelector(SUBHEAD_SELECTOR_SHORTS),
    newText: fresh.viewCountText
  });
}

export function changingShortsTextElements({ elItem, fresh }: Prettify<ItemTextChange>) {
  const elements: HTMLElement[] = [];
  const elTitle = elItem.querySelector<HTMLElement>(TITLE_SELECTOR_SHORTS);
  const isTitleChanging = elTitle !== null && elTitle.textContent !== fresh.title && fresh.title !== "";
  if (isTitleChanging) {
    elements.push(elTitle);
  }

  const elSubhead = elItem.querySelector<HTMLElement>(SUBHEAD_SELECTOR_SHORTS);
  const isSubheadChanging = elSubhead !== null && elSubhead.textContent !== fresh.viewCountText;
  if (isSubheadChanging) {
    elements.push(elSubhead);
  }

  return elements;
}

export function updateLegacyRendererTextFields({ elItem, fresh }: Prettify<ItemTextChange>) {
  setNodeTextIfChanged({
    elNode: elItem.querySelector(LEGACY_TITLE_SELECTOR),
    newText: fresh.title
  });

  const elMeta = elItem.querySelector("#metadata-line");
  if (!elMeta) {
    return;
  }

  const elMetaSpans = elMeta.querySelectorAll<HTMLElement>(":scope > span.inline-metadata-item");
  setNodeTextIfChanged({
    elNode: elMetaSpans[0] ?? null,
    newText: fresh.viewCountText
  });
  setNodeTextIfChanged({
    elNode: elMetaSpans[1] ?? null,
    newText: fresh.publishedTimeText
  });
}

export function changingLegacyTextElements({ elItem, fresh }: Prettify<ItemTextChange>) {
  const elements: HTMLElement[] = [];
  const elTitle = elItem.querySelector<HTMLElement>(LEGACY_TITLE_SELECTOR);
  const isTitleChanging = elTitle !== null && elTitle.textContent !== fresh.title && fresh.title !== "";
  if (isTitleChanging) {
    elements.push(elTitle);
  }

  const elMeta = elItem.querySelector("#metadata-line");
  const elMetaSpans = elMeta?.querySelectorAll<HTMLElement>(":scope > span.inline-metadata-item") ?? [];
  const [elViews, elTime] = elMetaSpans;
  const isViewsChanging = elViews !== undefined && elViews.textContent !== fresh.viewCountText;
  if (isViewsChanging) {
    elements.push(elViews);
  }

  const isTimeChanging = elTime !== undefined && elTime.textContent !== fresh.publishedTimeText;
  if (isTimeChanging) {
    elements.push(elTime);
  }

  return elements;
}
