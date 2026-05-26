import { isLockupViewModel, isShortsLockupViewModel, isVideoRenderer } from "../api/guards";
import {
  deepArray,
  deepRecord,
  deepString,
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
  if (elements.length === 0 || !("startViewTransition" in document)) {
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

function setNodeTextIfChanged(elNode: Element | null, newText: string) {
  if (!elNode || elNode.textContent === newText) {
    return;
  }

  elNode.textContent = newText;
}

function setAttributeIfChanged(elNode: Element | null, name: string, value: string) {
  if (!elNode || !value || elNode.getAttribute(name) === value) {
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

function buildAriaLabelUpdate(elTitleLink: HTMLAnchorElement | null, existingTitle: string, newTitle: string) {
  if (!elTitleLink || !newTitle || !existingTitle || existingTitle === newTitle) {
    return null;
  }

  const existingAriaLabel = elTitleLink.getAttribute("aria-label");
  if (!existingAriaLabel || !existingAriaLabel.startsWith(existingTitle)) {
    return null;
  }

  return `${newTitle}${existingAriaLabel.slice(existingTitle.length)}`;
}

function applyLockupTextChanges({ refs, fresh }: {
  refs: LockupTextElements;
  fresh: VideoSnapshot;
}) {
  const existingTitle = refs.elTitle?.textContent ?? "";
  setNodeTextIfChanged(refs.elTitle, fresh.title);
  setAttributeIfChanged(refs.elHeading, "title", fresh.title);
  const newAriaLabel = buildAriaLabelUpdate(refs.elTitleLink, existingTitle, fresh.title);
  if (newAriaLabel !== null) {
    refs.elTitleLink?.setAttribute("aria-label", newAriaLabel);
  }

  setNodeTextIfChanged(refs.elView, fresh.viewCountText);
  setNodeTextIfChanged(refs.elTime, fresh.publishedTimeText);
}

function changingLockupTextElements({ refs, fresh }: {
  refs: LockupTextElements;
  fresh: VideoSnapshot;
}) {
  const elements: HTMLElement[] = [];
  if (refs.elTitle && refs.elTitle.textContent !== fresh.title && fresh.title) {
    elements.push(refs.elTitle);
  }

  if (refs.elView && refs.elView.textContent !== fresh.viewCountText) {
    elements.push(refs.elView);
  }

  if (refs.elTime && refs.elTime.textContent !== fresh.publishedTimeText) {
    elements.push(refs.elTime);
  }

  return elements;
}

function updateShortsTextFields({ elItem, fresh }: {
  elItem: HTMLElement;
  fresh: VideoSnapshot;
}) {
  setNodeTextIfChanged(elItem.querySelector(TITLE_SELECTOR_SHORTS), fresh.title);
  setAttributeIfChanged(elItem.querySelector(TITLE_LINK_SELECTOR_SHORTS), "title", fresh.title);
  setNodeTextIfChanged(elItem.querySelector(SUBHEAD_SELECTOR_SHORTS), fresh.viewCountText);
}

function changingShortsTextElements({ elItem, fresh }: {
  elItem: HTMLElement;
  fresh: VideoSnapshot;
}) {
  const elements: HTMLElement[] = [];
  const elTitle = elItem.querySelector<HTMLElement>(TITLE_SELECTOR_SHORTS);
  if (elTitle && elTitle.textContent !== fresh.title && fresh.title) {
    elements.push(elTitle);
  }

  const elSubhead = elItem.querySelector<HTMLElement>(SUBHEAD_SELECTOR_SHORTS);
  if (elSubhead && elSubhead.textContent !== fresh.viewCountText) {
    elements.push(elSubhead);
  }

  return elements;
}

function updateLegacyRendererTextFields({ elItem, fresh }: {
  elItem: HTMLElement;
  fresh: VideoSnapshot;
}) {
  setNodeTextIfChanged(elItem.querySelector("#video-title yt-formatted-string, #video-title-link yt-formatted-string, #video-title"), fresh.title);

  const elMeta = elItem.querySelector("#metadata-line");
  if (!elMeta) {
    return;
  }

  const elMetaSpans = elMeta.querySelectorAll<HTMLElement>(":scope > span.inline-metadata-item");
  setNodeTextIfChanged(elMetaSpans[0] ?? null, fresh.viewCountText);
  setNodeTextIfChanged(elMetaSpans[1] ?? null, fresh.publishedTimeText);
}

function changingLegacyTextElements({ elItem, fresh }: {
  elItem: HTMLElement;
  fresh: VideoSnapshot;
}) {
  const elements: HTMLElement[] = [];
  const elTitle = elItem.querySelector<HTMLElement>("#video-title yt-formatted-string, #video-title-link yt-formatted-string, #video-title");
  if (elTitle && elTitle.textContent !== fresh.title && fresh.title) {
    elements.push(elTitle);
  }

  const elMeta = elItem.querySelector("#metadata-line");
  const elMetaSpans = elMeta?.querySelectorAll<HTMLElement>(":scope > span.inline-metadata-item") ?? [];
  if (elMetaSpans[0] && elMetaSpans[0].textContent !== fresh.viewCountText) {
    elements.push(elMetaSpans[0]);
  }

  if (elMetaSpans[1] && elMetaSpans[1].textContent !== fresh.publishedTimeText) {
    elements.push(elMetaSpans[1]);
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

function hasSameThumbnail(existing: LockupViewModel, incoming: LockupViewModel) {
  return getThumbnailUrlKey(existing.contentImage) === getThumbnailUrlKey(incoming.contentImage);
}

function mergeContentImagePreservingThumbnail(
  existing: LockupViewModel["contentImage"],
  incoming: LockupViewModel["contentImage"]
): LockupViewModel["contentImage"] {
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

  return {
    ...incoming,
    thumbnailViewModel: {
      ...incomingThumb,
      image: existingThumb.image ?? incomingThumb.image
    }
  };
}

function mutateLockupViewModelInPlace({ existing, incoming, preserveContentImage }: {
  existing: LockupViewModel;
  incoming: LockupViewModel;
  preserveContentImage: boolean;
}) {
  const existingAvatarImage = getAvatarImage(existing);
  const incomingAvatarImage = getAvatarImage(incoming);
  const preservedContentImage = existing.contentImage;

  Object.assign(existing, incoming);

  if (preserveContentImage) {
    existing.contentImage = mergeContentImagePreservingThumbnail(preservedContentImage, incoming.contentImage);
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

function buildPreservedAvatarMetadata({ existing, incoming }: {
  existing: LockupViewModel;
  incoming: LockupViewModel;
}) {
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

function mergeLockupViewModel({ existing, incoming, forcePreserveContentImage = false }: {
  existing: LockupViewModel;
  incoming: LockupViewModel;
  forcePreserveContentImage?: boolean;
}) {
  const shouldPreserveThumbnail = forcePreserveContentImage || hasSameThumbnail(existing, incoming);
  const contentImage = shouldPreserveThumbnail
    ? mergeContentImagePreservingThumbnail(existing.contentImage, incoming.contentImage)
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
  if (!forcePreserveContentImage || existing === null || !isVideoRenderer(incoming)) {
    return incoming;
  }

  const { thumbnail } = existing;
  if (!isRendererThumbnail(thumbnail)) {
    return incoming;
  }

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
        if (deepString(item, "videoRenderer", "videoId") === videoId) {
          rendererKey = "videoRenderer";
        } else if (deepString(item, "gridVideoRenderer", "videoId") === videoId) {
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

async function applyTargetedGenericUpdate({ videoId, elItem, previous, fresh }: {
  videoId: string;
  elItem: PolymerElement;
  previous: VideoSnapshot;
  fresh: VideoSnapshot;
}) {
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

  const elImg = previous.thumbnailUrl !== fresh.thumbnailUrl ? findThumbnailImgInItem(elItem) : null;
  if (previous.thumbnailUrl !== fresh.thumbnailUrl && !elImg) {
    applyPolymerUpdate({
      elItem,
      rawRenderer: fresh.rawRenderer
    });
    syncGridModelItem({
      videoId,
      rawRenderer: fresh.rawRenderer
    });
    return;
  }

  const thumbWork = elImg
    ? await prepareThumbnailDissolve({
      elItem,
      elImg,
      newUrl: fresh.thumbnailUrl
    })
    : null;
  if (textElements.length === 0 && !thumbWork?.willDissolve) {
    if (elImg && previous.thumbnailUrl !== fresh.thumbnailUrl) {
      syncGridModelItem({
        videoId,
        rawRenderer: fresh.rawRenderer,
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
        rawRenderer: fresh.rawRenderer,
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
}: {
  videoId: string;
  elItem: PolymerElement;
  elLockup: HTMLElement;
  previous: VideoSnapshot;
  fresh: VideoSnapshot;
}) {
  const refs = collectLockupTextElements(elLockup);
  const textElements = changingLockupTextElements({
    refs,
    fresh
  });

  const freshRawRenderer = fresh.rawRenderer;
  const freshLockup = isLockupViewModel(freshRawRenderer) ? freshRawRenderer : null;
  const newUrl = freshLockup?.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url ?? fresh.thumbnailUrl;
  const thumbUrlDiffers = previous.thumbnailUrl !== fresh.thumbnailUrl;
  const elImg = thumbUrlDiffers ? findThumbnailImg(elLockup) : null;
  if (thumbUrlDiffers && !elImg) {
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
  const isWatchProgressChanged = previous.watchProgressPercent !== fresh.watchProgressPercent;
  if (textElements.length === 0 && !thumbWork?.willDissolve) {
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
        percent: fresh.watchProgressPercent
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
        applyProgressBarUpdate({
          elLockup,
          percent: fresh.watchProgressPercent
        });
      }
    }
  });
}

export function applyUpdate({ videoId, elItem, fresh, previous }: {
  videoId: string;
  elItem: PolymerElement;
  fresh: VideoSnapshot;
  previous?: VideoSnapshot;
}) {
  const isChannelLiveChanged = !!previous && previous.isChannelLive !== fresh.isChannelLive;
  if (!previous || previous.status !== fresh.status || isChannelLiveChanged) {
    applyPolymerUpdate({
      elItem,
      rawRenderer: fresh.rawRenderer
    });
    syncGridModelItem({
      videoId,
      rawRenderer: fresh.rawRenderer,
      forcePreserveContentImage: isChannelLiveChanged && previous.status === fresh.status
    });
    return;
  }

  const itemData = elItem.data;
  if (!isRecord(itemData)) {
    applyPolymerUpdate({
      elItem,
      rawRenderer: fresh.rawRenderer
    });
    syncGridModelItem({
      videoId,
      rawRenderer: fresh.rawRenderer
    });
    return;
  }

  const { content } = itemData;
  const elLockup = isRecord(content) && isRecord(content.lockupViewModel)
    ? elItem.querySelector<HTMLElement>("yt-lockup-view-model")
    : null;
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

    const videoId = deepString(elItem.data, "videoId");
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
