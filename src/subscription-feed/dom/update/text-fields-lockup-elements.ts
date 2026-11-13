import type { Prettify } from "../../types/prettify";

const TITLE_SELECTOR_LOCKUP = ".ytLockupMetadataViewModelTitle span.ytAttributedStringHost";
const TITLE_HEADING_SELECTOR_LOCKUP = ".ytLockupMetadataViewModelHeadingReset";
const TITLE_LINK_SELECTOR_LOCKUP = "a.ytLockupMetadataViewModelTitle";
const METADATA_PART_SELECTOR_LOCKUP =
  "yt-lockup-metadata-view-model .ytContentMetadataViewModelMetadataRow > span.ytContentMetadataViewModelMetadataText";

export interface LockupTextElements {
  elTitle: HTMLElement | null;
  elHeading: HTMLElement | null;
  elTitleLink: HTMLAnchorElement | null;
  // One span per metadata part, in the order YouTube lists the parts.
  elMetadataParts: HTMLElement[];
}

export function collectLockupTextElements(elLockup: HTMLElement): Prettify<LockupTextElements> {
  const elTitle = elLockup.querySelector<HTMLElement>(TITLE_SELECTOR_LOCKUP);
  const elHeading = elLockup.querySelector<HTMLElement>(TITLE_HEADING_SELECTOR_LOCKUP);
  const elTitleLink = elLockup.querySelector<HTMLAnchorElement>(TITLE_LINK_SELECTOR_LOCKUP);
  return {
    elTitle,
    elHeading,
    elTitleLink,
    elMetadataParts: [...elLockup.querySelectorAll<HTMLElement>(METADATA_PART_SELECTOR_LOCKUP)]
  };
}
