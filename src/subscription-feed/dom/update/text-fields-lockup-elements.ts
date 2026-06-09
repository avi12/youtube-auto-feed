import type { Prettify } from "../../types/prettify";

const TITLE_SELECTOR_LOCKUP = ".ytLockupMetadataViewModelTitle span.ytAttributedStringHost";
const TITLE_HEADING_SELECTOR_LOCKUP = ".ytLockupMetadataViewModelHeadingReset";
const TITLE_LINK_SELECTOR_LOCKUP = "a.ytLockupMetadataViewModelTitle";
const METADATA_ROW_SELECTOR_LOCKUP = ".ytContentMetadataViewModelMetadataRow";
const METADATA_TEXT_SELECTOR_LOCKUP = ":scope > span.ytContentMetadataViewModelMetadataText";
const METADATA_DELIMITER_SELECTOR_LOCKUP = ".ytContentMetadataViewModelDelimiter";

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
