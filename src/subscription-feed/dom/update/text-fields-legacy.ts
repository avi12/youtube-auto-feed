import type { Prettify } from "../../types/prettify";
import type { VideoSnapshot } from "../../types/video";
import { setAttributeIfChanged, setNodeTextIfChanged } from "./dissolve";

// In-place text edits for the shorts (shorts shelf lockup) and legacy (videoRenderer) renderer
// shapes. updateXTextFields writes text; changingXTextElements returns the nodes whose text will
// change so the dissolve wrapper knows what to animate.

const TITLE_SELECTOR_SHORTS = ".shortsLockupViewModelHostMetadataTitle .ytAttributedStringHost";
const TITLE_LINK_SELECTOR_SHORTS = "a.shortsLockupViewModelHostOutsideMetadataEndpoint";
const SUBHEAD_SELECTOR_SHORTS = ".shortsLockupViewModelHostOutsideMetadataSubhead .ytAttributedStringHost";
const LEGACY_TITLE_SELECTOR = "#video-title yt-formatted-string, #video-title-link yt-formatted-string, #video-title";

interface ItemTextChange {
  elItem: HTMLElement;
  fresh: VideoSnapshot;
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
