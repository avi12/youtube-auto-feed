import type { Prettify } from "../../types/prettify";
import { VIEW_COUNT_TEXT_PATTERN } from "../../youtube-api/parse-lockup";

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
  const elLoneSpan = elTextSpans?.length === 1 ? elTextSpans[0] ?? null : null;
  // Mirrors splitLockupMetadata: a lone metadata part that does not read like a view count is the
  // published time (e.g. an upcoming stream's "Scheduled for ..."), so slot it as elTime.
  const isLoneSpanPublishedTime = !!elLoneSpan && !VIEW_COUNT_TEXT_PATTERN.test(elLoneSpan.textContent ?? "");
  if (isLoneSpanPublishedTime) {
    return {
      elTitle,
      elHeading,
      elTitleLink,
      elView: null,
      elTime: elLoneSpan
    };
  }

  return {
    elTitle,
    elHeading,
    elTitleLink,
    elView: elTextSpans?.[0] ?? null,
    elTime: elTextSpans?.[1] ?? null
  };
}
