import { isLockupViewModel, isShortsLockupViewModel, isVideoRenderer } from "../api/guards";
import {
  deepArray,
  deepRecord,
  isPolymerElement,
  isRecord,
  videoIdFromData
} from "../helpers";
import type {
  InnerTubeRichGridItem,
  InnerTubeRichItemContent,
  InnerTubeVideoRenderer,
  LockupViewModel,
  PolymerElement,
  VideoSnapshot
} from "../types";
import { isInViewport, withViewTransitionLock } from "./animations";
import { scheduleLazyUpdate } from "./lazy-update";
import { findItemElement } from "./query";
import { findRichItemIndex } from "./rich-item";

const FETCH_CHUNK_SIZE = 8192;

const TITLE_SELECTOR_LOCKUP = ".ytLockupMetadataViewModelTitle span.ytAttributedStringHost";
const TITLE_HEADING_SELECTOR_LOCKUP = ".ytLockupMetadataViewModelHeadingReset";
const TITLE_LINK_SELECTOR_LOCKUP = "a.ytLockupMetadataViewModelTitle";
const METADATA_ROW_SELECTOR_LOCKUP = ".ytContentMetadataViewModelMetadataRow";
const METADATA_TEXT_SELECTOR_LOCKUP = ":scope > span.ytContentMetadataViewModelMetadataText";
const METADATA_DELIMITER_SELECTOR_LOCKUP = ".ytContentMetadataViewModelDelimiter";
const TITLE_SELECTOR_SHORTS = ".shortsLockupViewModelHostMetadataTitle .ytAttributedStringHost";
const TITLE_LINK_SELECTOR_SHORTS = "a.shortsLockupViewModelHostOutsideMetadataEndpoint";
const SUBHEAD_SELECTOR_SHORTS = ".shortsLockupViewModelHostOutsideMetadataSubhead .ytAttributedStringHost";

let transitionCounter = 0;

interface NamedElement {
  elTarget: HTMLElement;
  previousName: string;
}

async function applyWithDissolve({ elements, apply }: {
  elements: HTMLElement[];
  apply: () => void;
}) {
  const isViewTransitionUnavailable = elements.length === 0 || !("startViewTransition" in document);
  if (isViewTransitionUnavailable) {
    apply();
    return;
  }

  await withViewTransitionLock(async () => {
    transitionCounter++;
    const transitionId = transitionCounter;
    const named: NamedElement[] = elements.map((elTarget, iElement) => {
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

function setNodeTextIfChanged({ elNode, newText }: {
  elNode: Element | null;
  newText: string;
}) {
  const isUpdateNeeded = elNode !== null && elNode.textContent !== newText;
  if (!isUpdateNeeded) {
    return;
  }

  elNode.textContent = newText;
}

function setAttributeIfChanged({ elNode, name, value }: {
  elNode: Element | null;
  name: string;
  value: string;
}) {
  const isUpdateNeeded = elNode !== null && value !== "" && elNode.getAttribute(name) !== value;
  if (!isUpdateNeeded) {
    return;
  }

  elNode.setAttribute(name, value);
}

interface LockupTextElements {
  elTitle: HTMLElement | null;
  elHeading: HTMLElement | null;
  elTitleLink: HTMLAnchorElement | null;
  elView: HTMLElement | null;
  elTime: HTMLElement | null;
}

function collectLockupTextElements(elLockup: HTMLElement): LockupTextElements {
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
  // Aria-label is "{title} by {channel} {views} {time}"; only patch when prefix matches the prior title
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

function applyLockupTextChanges({ refs, fresh }: LockupTextChange) {
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

function changingLockupTextElements({ refs, fresh }: LockupTextChange) {
  const elements: HTMLElement[] = [];
  const { elTitle, elView, elTime } = refs;
  if (elTitle && elTitle.textContent !== fresh.title && fresh.title !== "") {
    elements.push(elTitle);
  }

  if (elView && elView.textContent !== fresh.viewCountText) {
    elements.push(elView);
  }

  if (elTime && elTime.textContent !== fresh.publishedTimeText) {
    elements.push(elTime);
  }

  return elements;
}

function updateShortsTextFields({ elItem, fresh }: ItemTextChange) {
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

function changingShortsTextElements({ elItem, fresh }: ItemTextChange) {
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

const LEGACY_TITLE_SELECTOR = "#video-title yt-formatted-string, #video-title-link yt-formatted-string, #video-title";

function updateLegacyRendererTextFields({ elItem, fresh }: ItemTextChange) {
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

function changingLegacyTextElements({ elItem, fresh }: ItemTextChange) {
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

function findThumbnailImg(elLockup: HTMLElement) {
  const root: ShadowRoot | HTMLElement = elLockup.shadowRoot ?? elLockup;
  for (const elYtImage of root.querySelectorAll<HTMLElement>("yt-image")) {
    const elImg = elYtImage.shadowRoot?.querySelector<HTMLImageElement>("img")
      ?? elYtImage.querySelector<HTMLImageElement>("img");
    if (elImg) {
      return elImg;
    }
  }
  return root.querySelector<HTMLImageElement>("yt-thumbnail-view-model img");
}

function applyProgressBarUpdate({ elLockup, percent }: {
  elLockup: HTMLElement;
  percent: number | null;
}) {
  if (percent === null) {
    return false;
  }

  const root: ShadowRoot | HTMLElement = elLockup.shadowRoot ?? elLockup;
  const elProgressHost = root.querySelector<HTMLElement>("yt-thumbnail-overlay-progress-bar-view-model");
  if (!elProgressHost) {
    return false;
  }

  const fillRoot: ShadowRoot | HTMLElement = elProgressHost.shadowRoot ?? elProgressHost;
  const elFill = fillRoot.querySelector<HTMLElement>(":scope > div > div");
  if (!elFill) {
    return false;
  }

  elFill.style.width = `${percent}%`;
  return true;
}

function findThumbnailImgInItem(elItem: HTMLElement) {
  const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
  if (elLockup) {
    const elImg = findThumbnailImg(elLockup);
    if (elImg) {
      return elImg;
    }
  }

  for (const elYtImage of elItem.querySelectorAll<HTMLElement>("ytd-thumbnail yt-image")) {
    const elImg = elYtImage.shadowRoot?.querySelector<HTMLImageElement>("img")
      ?? elYtImage.querySelector<HTMLImageElement>("img");
    if (elImg) {
      return elImg;
    }
  }
  return null;
}

async function fetchImageBase64(url: string) {
  const response = await fetch(url.split("?")[0]);
  if (!response.ok) {
    return null;
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = FETCH_CHUNK_SIZE;
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function areThumbnailsDifferent({ currentSrc, newSrc }: {
  currentSrc: string;
  newSrc: string;
}) {
  if (currentSrc.split("?")[0] === newSrc.split("?")[0]) {
    return false;
  }

  try {
    const [currentBase64, newBase64] = await Promise.all([
      fetchImageBase64(currentSrc),
      fetchImageBase64(newSrc)
    ]);
    if (currentBase64 === null || newBase64 === null) {
      return true;
    }

    return currentBase64 !== newBase64;
  } catch {
    return true;
  }
}

function preloadImage(url: string) {
  return new Promise<void>(resolve => {
    const preload = new Image();
    preload.onload = () => resolve();
    preload.onerror = () => resolve();
    preload.src = url;
  });
}

async function prepareThumbnailDissolve({ elItem, elImg, newUrl }: {
  elItem: HTMLElement;
  elImg: HTMLImageElement;
  newUrl: string;
}) {
  if (elItem.matches(":hover")) {
    return {
      willDissolve: false,
      newUrl
    };
  }

  const isDifferent = await areThumbnailsDifferent({
    currentSrc: elImg.src,
    newSrc: newUrl
  });
  if (!isDifferent) {
    return {
      willDissolve: false,
      newUrl
    };
  }

  await preloadImage(newUrl);

  if (elItem.matches(":hover")) {
    return {
      willDissolve: false,
      newUrl
    };
  }

  return {
    willDissolve: true,
    newUrl
  };
}

function getThumbnailUrlKey(contentImage: LockupViewModel["contentImage"]) {
  return contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url?.split("?")[0];
}

function getAvatarImage(viewModel: LockupViewModel) {
  return viewModel.metadata?.lockupMetadataViewModel?.image;
}

interface LockupPair {
  existing: LockupViewModel;
  incoming: LockupViewModel;
}

function hasSameThumbnail({ existing, incoming }: LockupPair) {
  return getThumbnailUrlKey(existing.contentImage) === getThumbnailUrlKey(incoming.contentImage);
}

function mergeContentImagePreservingThumbnail({ existing, incoming }: {
  existing: LockupViewModel["contentImage"];
  incoming: LockupViewModel["contentImage"];
}): LockupViewModel["contentImage"] {
  if (!existing) {
    return incoming;
  }

  if (!incoming) {
    return existing;
  }

  const existingThumb = existing.thumbnailViewModel;
  const incomingThumb = incoming.thumbnailViewModel;
  if (!incomingThumb) {
    return existing;
  }

  if (!existingThumb) {
    return incoming;
  }

  // Keep the already-loaded image bytes to avoid a network re-fetch when the URL key is unchanged
  return {
    ...incoming,
    thumbnailViewModel: {
      ...incomingThumb,
      image: existingThumb.image ?? incomingThumb.image
    }
  };
}

function mutateLockupViewModelInPlace({ existing, incoming, preserveContentImage }: LockupPair & {
  preserveContentImage: boolean;
}) {
  const existingAvatarImage = getAvatarImage(existing);
  const incomingAvatarImage = getAvatarImage(incoming);
  const preservedContentImage = existing.contentImage;

  Object.assign(existing, incoming);

  if (preserveContentImage) {
    existing.contentImage = mergeContentImagePreservingThumbnail({
      existing: preservedContentImage,
      incoming: incoming.contentImage
    });
  }

  const shouldRestoreAvatar = incomingAvatarImage === undefined
    && existingAvatarImage !== undefined
    && existing.metadata?.lockupMetadataViewModel !== undefined;
  if (!shouldRestoreAvatar) {
    return;
  }

  existing.metadata = {
    ...existing.metadata,
    lockupMetadataViewModel: {
      ...existing.metadata?.lockupMetadataViewModel,
      image: existingAvatarImage
    }
  };
}

function mutateLockupMetadata({ videoId, elItem, incoming, preserveContentImage }: {
  videoId: string;
  elItem: PolymerElement;
  incoming: LockupViewModel;
  preserveContentImage: boolean;
}) {
  const seenLockups = new Set<LockupViewModel>();
  function mutateOne(candidate: unknown) {
    if (!isLockupViewModel(candidate) || seenLockups.has(candidate)) {
      return;
    }

    seenLockups.add(candidate);
    mutateLockupViewModelInPlace({
      existing: candidate,
      incoming,
      preserveContentImage
    });
  }

  const itemData = elItem.data;
  if (isRecord(itemData) && isRecord(itemData.content)) {
    mutateOne(itemData.content.lockupViewModel);
  }

  for (const elGrid of document.querySelectorAll<HTMLElement>("ytd-rich-grid-renderer")) {
    if (!isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
      continue;
    }

    const contents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents");
    const iItem = findRichItemIndex({
      contents,
      videoId
    });
    if (iItem < 0) {
      continue;
    }

    const content = deepRecord(contents[iItem], "richItemRenderer", "content");
    if (content) {
      mutateOne(content.lockupViewModel);
    }
  }

  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf) || !isRecord(elShelf.data)) {
      continue;
    }

    const contents = deepArray<InnerTubeRichGridItem>(elShelf.data, "contents");
    const iItem = findRichItemIndex({
      contents,
      videoId
    });
    if (iItem < 0) {
      continue;
    }

    const content = deepRecord(contents[iItem], "richItemRenderer", "content");
    if (content) {
      mutateOne(content.lockupViewModel);
    }
  }
}

function buildPreservedAvatarMetadata({ existing, incoming }: LockupPair) {
  const existingAvatarImage = getAvatarImage(existing);
  const incomingLockupMeta = incoming.metadata?.lockupMetadataViewModel;
  if (incomingLockupMeta === undefined && existingAvatarImage === undefined) {
    return incoming.metadata;
  }

  return {
    ...incoming.metadata,
    lockupMetadataViewModel: {
      ...incomingLockupMeta,
      image: getAvatarImage(incoming) ?? existingAvatarImage
    }
  };
}

function mergeLockupViewModel({ existing, incoming, forcePreserveContentImage = false }: LockupPair & {
  forcePreserveContentImage?: boolean;
}) {
  const shouldPreserveThumbnail = forcePreserveContentImage || hasSameThumbnail({
    existing,
    incoming
  });
  const contentImage = shouldPreserveThumbnail
    ? mergeContentImagePreservingThumbnail({
      existing: existing.contentImage,
      incoming: incoming.contentImage
    })
    : incoming.contentImage;
  return {
    ...incoming,
    contentImage,
    metadata: buildPreservedAvatarMetadata({
      existing,
      incoming
    })
  };
}

function applyPolymerUpdate({ elItem, rawRenderer }: {
  elItem: PolymerElement;
  rawRenderer: VideoSnapshot["rawRenderer"];
}) {
  const itemData = elItem.data;
  if (!isRecord(itemData)) {
    return;
  }

  const { content } = itemData;
  if (!isRecord(content)) {
    elItem.set("data", rawRenderer);
    return;
  }

  if (isLockupViewModel(content.lockupViewModel) && isLockupViewModel(rawRenderer)) {
    const merged = mergeLockupViewModel({
      existing: content.lockupViewModel,
      incoming: rawRenderer
    });
    const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
    if (elLockup && "lockupViewModel" in elLockup) {
      Object.assign(elLockup, { lockupViewModel: merged });
      return;
    }

    elItem.set("data", {
      ...itemData,
      content: {
        ...content,
        lockupViewModel: merged
      }
    });
    return;
  }

  if (isShortsLockupViewModel(content.shortsLockupViewModel) && isShortsLockupViewModel(rawRenderer)) {
    const elShortsLockup = elItem.querySelector<HTMLElement>("yt-shorts-lockup-view-model");
    if (elShortsLockup && "shortsLockupViewModel" in elShortsLockup) {
      Object.assign(elShortsLockup, { shortsLockupViewModel: rawRenderer });
      return;
    }

    elItem.set("data", {
      ...itemData,
      content: {
        ...content,
        shortsLockupViewModel: rawRenderer
      }
    });
    return;
  }

  if (isRecord(content.videoRenderer)) {
    elItem.set("data.content.videoRenderer", rawRenderer);
    return;
  }

  if (isRecord(content.gridVideoRenderer)) {
    elItem.set("data.content.gridVideoRenderer", rawRenderer);
    return;
  }

  if (deepRecord(content, "richGridMediaRenderer")) {
    elItem.set("data.content.richGridMediaRenderer.content.videoRenderer", rawRenderer);
  }
}

function isRendererThumbnail(value: unknown): value is InnerTubeVideoRenderer["thumbnail"] {
  return isRecord(value) && Array.isArray(value.thumbnails);
}

function buildMergedVideoRenderer({
  existing,
  incoming,
  forcePreserveContentImage
}: {
  existing: InnerTubeVideoRenderer | Record<string, unknown> | null;
  incoming: VideoSnapshot["rawRenderer"];
  forcePreserveContentImage: boolean;
}) {
  const isMergeSkipped = !forcePreserveContentImage || existing === null || !isVideoRenderer(incoming);
  if (isMergeSkipped) {
    return incoming;
  }

  const { thumbnail } = existing;
  if (!isRendererThumbnail(thumbnail)) {
    return incoming;
  }

  // Preserve the existing thumbnail object so the in-flight <img> keeps its decoded bytes
  return {
    ...incoming,
    thumbnail
  };
}

function applyRichItemContentUpdate({
  elElement,
  basePath,
  existingContent,
  rawRenderer,
  forcePreserveContentImage
}: {
  elElement: PolymerElement;
  basePath: string;
  existingContent: InnerTubeRichItemContent | Record<string, unknown>;
  rawRenderer: VideoSnapshot["rawRenderer"];
  forcePreserveContentImage: boolean;
}) {
  if (isRecord(existingContent.richGridMediaRenderer)) {
    elElement.set(`${basePath}.richGridMediaRenderer.content.videoRenderer`, rawRenderer);
    return;
  }

  if (isLockupViewModel(rawRenderer) || isRecord(existingContent.lockupViewModel)) {
    const existingLockup = existingContent.lockupViewModel;
    const merged = isLockupViewModel(rawRenderer) && isLockupViewModel(existingLockup)
      ? mergeLockupViewModel({
        existing: existingLockup,
        incoming: rawRenderer,
        forcePreserveContentImage
      })
      : rawRenderer;
    elElement.set(`${basePath}.lockupViewModel`, merged);
    return;
  }

  if (isShortsLockupViewModel(rawRenderer) || isRecord(existingContent.shortsLockupViewModel)) {
    elElement.set(`${basePath}.shortsLockupViewModel`, rawRenderer);
    return;
  }

  if (isRecord(existingContent.gridVideoRenderer)) {
    elElement.set(
      `${basePath}.gridVideoRenderer`, buildMergedVideoRenderer({
        existing: existingContent.gridVideoRenderer,
        incoming: rawRenderer,
        forcePreserveContentImage
      })
    );
    return;
  }

  elElement.set(
    `${basePath}.videoRenderer`, buildMergedVideoRenderer({
      existing: deepRecord(existingContent, "videoRenderer"),
      incoming: rawRenderer,
      forcePreserveContentImage
    })
  );
}

function tryApplyToGrid({ videoId, rawRenderer, forcePreserveContentImage }: {
  videoId: string;
  rawRenderer: VideoSnapshot["rawRenderer"];
  forcePreserveContentImage: boolean;
}) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return false;
  }

  const contents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents");
  const iItem = findRichItemIndex({
    contents,
    videoId
  });
  if (iItem < 0) {
    return false;
  }

  const existingContent = deepRecord(contents[iItem], "richItemRenderer", "content");
  if (existingContent) {
    applyRichItemContentUpdate({
      elElement: elGrid,
      basePath: `data.contents.${iItem}.richItemRenderer.content`,
      existingContent,
      rawRenderer,
      forcePreserveContentImage
    });
  }

  return true;
}

function syncGridModelItem({ videoId, rawRenderer, forcePreserveContentImage = false }: {
  videoId: string;
  rawRenderer: VideoSnapshot["rawRenderer"];
  forcePreserveContentImage?: boolean;
}) {
  if (tryApplyToGrid({
    videoId,
    rawRenderer,
    forcePreserveContentImage
  })) {
    return;
  }

  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf) || !isRecord(elShelf.data)) {
      continue;
    }

    const contents = deepArray<InnerTubeRichGridItem>(elShelf.data, "contents");
    const iItem = findRichItemIndex({
      contents,
      videoId
    });
    if (iItem < 0) {
      continue;
    }

    const existingContent = deepRecord(contents[iItem], "richItemRenderer", "content");
    if (existingContent) {
      applyRichItemContentUpdate({
        elElement: elShelf,
        basePath: `data.contents.${iItem}.richItemRenderer.content`,
        existingContent,
        rawRenderer,
        forcePreserveContentImage
      });
    }

    return;
  }

  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-shelf-renderer")) {
    if (!isPolymerElement(elShelf) || !isRecord(elShelf.data)) {
      continue;
    }

    const shelfContent = deepRecord(elShelf.data, "content");
    for (const listKey of ["horizontalListRenderer", "gridRenderer"] as const) {
      type ShelfListItem = {
        videoRenderer?: InnerTubeVideoRenderer;
        gridVideoRenderer?: InnerTubeVideoRenderer;
      };
      const items = deepArray<ShelfListItem>(shelfContent, listKey, "items");
      for (const [iItem, item] of items.entries()) {
        let rendererKey: "videoRenderer" | "gridVideoRenderer" | null = null;
        if ((item.videoRenderer?.videoId ?? "") === videoId) {
          rendererKey = "videoRenderer";
        } else if ((item.gridVideoRenderer?.videoId ?? "") === videoId) {
          rendererKey = "gridVideoRenderer";
        }

        if (!rendererKey) {
          continue;
        }

        elShelf.set(
          `data.content.${listKey}.items.${iItem}.${rendererKey}`, buildMergedVideoRenderer({
            existing: deepRecord(item, rendererKey),
            incoming: rawRenderer,
            forcePreserveContentImage
          })
        );
        return;
      }
    }
  }
}

interface TargetedUpdateParams {
  videoId: string;
  elItem: PolymerElement;
  previous: VideoSnapshot;
  fresh: VideoSnapshot;
}

async function applyTargetedGenericUpdate({ videoId, elItem, previous, fresh }: TargetedUpdateParams) {
  const { rawRenderer, thumbnailUrl } = fresh;
  const isShorts = !!elItem.querySelector("ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model");
  const textElements = isShorts
    ? changingShortsTextElements({
      elItem,
      fresh
    })
    : changingLegacyTextElements({
      elItem,
      fresh
    });
  const applyText = isShorts
    ? () => updateShortsTextFields({
      elItem,
      fresh
    })
    : () => updateLegacyRendererTextFields({
      elItem,
      fresh
    });

  const isThumbnailChanging = previous.thumbnailUrl !== thumbnailUrl;
  const elImg = isThumbnailChanging ? findThumbnailImgInItem(elItem) : null;
  // Thumbnail changed but the live <img> couldn't be located, so rebuild the whole renderer
  if (isThumbnailChanging && !elImg) {
    applyPolymerUpdate({
      elItem,
      rawRenderer
    });
    syncGridModelItem({
      videoId,
      rawRenderer
    });
    return;
  }

  const thumbWork = elImg
    ? await prepareThumbnailDissolve({
      elItem,
      elImg,
      newUrl: thumbnailUrl
    })
    : null;
  const isNothingToAnimate = textElements.length === 0 && !thumbWork?.willDissolve;
  if (isNothingToAnimate) {
    // Thumbnail bytes are identical though URL changed; sync the model but keep DOM <img> alone
    if (elImg && isThumbnailChanging) {
      syncGridModelItem({
        videoId,
        rawRenderer,
        forcePreserveContentImage: true
      });
    }

    return;
  }

  const elements = [...textElements];
  if (thumbWork?.willDissolve && elImg) {
    elements.push(elImg);
  }

  await applyWithDissolve({
    elements,
    apply() {
      applyText();

      if (thumbWork?.willDissolve && elImg) {
        elImg.src = thumbWork.newUrl;
      }

      syncGridModelItem({
        videoId,
        rawRenderer,
        forcePreserveContentImage: !thumbWork?.willDissolve
      });
    }
  });
}

async function applyTargetedLockupUpdate({
  videoId,
  elItem,
  elLockup,
  previous,
  fresh
}: TargetedUpdateParams & {
  elLockup: HTMLElement;
}) {
  const refs = collectLockupTextElements(elLockup);
  const textElements = changingLockupTextElements({
    refs,
    fresh
  });

  const { rawRenderer: freshRawRenderer, thumbnailUrl, watchProgressPercent } = fresh;
  const freshLockup = isLockupViewModel(freshRawRenderer) ? freshRawRenderer : null;
  const newUrl = freshLockup?.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url ?? thumbnailUrl;
  const thumbUrlDiffers = previous.thumbnailUrl !== thumbnailUrl;
  const elImg = thumbUrlDiffers ? findThumbnailImg(elLockup) : null;
  // Thumbnail changed but the live <img> couldn't be located, so rebuild the whole renderer
  const isThumbnailUnreachable = thumbUrlDiffers && !elImg;
  if (isThumbnailUnreachable) {
    applyPolymerUpdate({
      elItem,
      rawRenderer: freshRawRenderer
    });
    syncGridModelItem({
      videoId,
      rawRenderer: freshRawRenderer
    });
    return;
  }

  const thumbWork = elImg
    ? await prepareThumbnailDissolve({
      elItem,
      elImg,
      newUrl
    })
    : null;
  const isWatchProgressChanged = previous.watchProgressPercent !== watchProgressPercent;
  const isNothingToAnimate = textElements.length === 0 && !thumbWork?.willDissolve;
  if (isNothingToAnimate) {
    if (freshLockup) {
      mutateLockupMetadata({
        videoId,
        elItem,
        incoming: freshLockup,
        preserveContentImage: true
      });
    }

    if (isWatchProgressChanged) {
      const didUpdate = applyProgressBarUpdate({
        elLockup,
        percent: watchProgressPercent
      });
      if (!didUpdate) {
        applyPolymerUpdate({
          elItem,
          rawRenderer: freshRawRenderer
        });
        syncGridModelItem({
          videoId,
          rawRenderer: freshRawRenderer,
          forcePreserveContentImage: true
        });
      }
    }

    return;
  }

  const elements = [...textElements];
  if (thumbWork?.willDissolve && elImg) {
    elements.push(elImg);
  }

  let isProgressBarDirty = false;
  await applyWithDissolve({
    elements,
    apply() {
      applyLockupTextChanges({
        refs,
        fresh
      });

      if (thumbWork?.willDissolve && elImg) {
        elImg.src = thumbWork.newUrl;
      }

      if (freshLockup) {
        mutateLockupMetadata({
          videoId,
          elItem,
          incoming: freshLockup,
          preserveContentImage: !thumbWork?.willDissolve
        });
      }

      if (isWatchProgressChanged) {
        isProgressBarDirty = !applyProgressBarUpdate({
          elLockup,
          percent: watchProgressPercent
        });
      }
    }
  });

  if (isProgressBarDirty) {
    applyPolymerUpdate({
      elItem,
      rawRenderer: freshRawRenderer
    });
    syncGridModelItem({
      videoId,
      rawRenderer: freshRawRenderer,
      forcePreserveContentImage: !thumbWork?.willDissolve
    });
  }
}

export function applyUpdate({ videoId, elItem, fresh, previous }: {
  videoId: string;
  elItem: PolymerElement;
  fresh: VideoSnapshot;
  previous?: VideoSnapshot;
}) {
  const { rawRenderer } = fresh;
  const isChannelLiveChanged = !!previous && previous.isChannelLive !== fresh.isChannelLive;
  // Status flips and channel-live flips require a full renderer swap; targeted DOM patches only handle metadata
  const needsFullRebuild = !previous || previous.status !== fresh.status || isChannelLiveChanged;
  if (needsFullRebuild) {
    applyPolymerUpdate({
      elItem,
      rawRenderer
    });
    // When only the channel-live flag changed, the thumbnail bytes are the same - keep them
    const isOnlyChannelLiveFlip = isChannelLiveChanged && previous !== undefined && previous.status === fresh.status;
    syncGridModelItem({
      videoId,
      rawRenderer,
      forcePreserveContentImage: isOnlyChannelLiveFlip
    });
    return;
  }

  const itemData = elItem.data;
  if (!isRecord(itemData)) {
    applyPolymerUpdate({
      elItem,
      rawRenderer
    });
    syncGridModelItem({
      videoId,
      rawRenderer
    });
    return;
  }

  const { content } = itemData;
  const hasLockupContent = isRecord(content) && isRecord(content.lockupViewModel);
  const elLockup = hasLockupContent ? elItem.querySelector<HTMLElement>("yt-lockup-view-model") : null;
  if (elLockup) {
    void applyTargetedLockupUpdate({
      videoId,
      elItem,
      elLockup,
      previous,
      fresh
    });
    return;
  }

  void applyTargetedGenericUpdate({
    videoId,
    elItem,
    previous,
    fresh
  });
}

export function updateVideoInDom({ videoId, freshSnapshot, previousSnapshot }: {
  videoId: string;
  freshSnapshot: VideoSnapshot;
  previousSnapshot?: VideoSnapshot;
}) {
  const elItem = findItemElement(videoId);
  if (!elItem || !isPolymerElement(elItem)) {
    return;
  }

  if (isInViewport(elItem)) {
    applyUpdate({
      videoId,
      elItem,
      fresh: freshSnapshot,
      previous: previousSnapshot
    });
  } else {
    scheduleLazyUpdate({
      videoId,
      fresh: freshSnapshot,
      previous: previousSnapshot
    });
  }
}

function buildVideoElementMap() {
  const map = new Map<string, HTMLElement>();
  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (videoId) {
      map.set(videoId, elItem);
    }
  }
  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const { data } = elItem;
    const videoId = isVideoRenderer(data) ? data.videoId : "";
    if (videoId) {
      map.set(videoId, elItem);
    }
  }
  return map;
}

export function batchUpdateVideosInDom({ freshSnapshots, previousSnapshotMap }: {
  freshSnapshots: VideoSnapshot[];
  previousSnapshotMap?: Map<string, VideoSnapshot>;
}) {
  const elementMap = buildVideoElementMap();
  for (const fresh of freshSnapshots) {
    const elItem = elementMap.get(fresh.videoId);
    if (!elItem || !isPolymerElement(elItem)) {
      continue;
    }

    const previous = previousSnapshotMap?.get(fresh.videoId);
    if (isInViewport(elItem)) {
      applyUpdate({
        videoId: fresh.videoId,
        elItem,
        fresh,
        previous
      });
    } else {
      scheduleLazyUpdate({
        videoId: fresh.videoId,
        fresh,
        previous,
        elItemHint: elItem
      });
    }
  }
}
