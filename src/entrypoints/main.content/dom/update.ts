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
  InnerTubeVideoRenderer,
  LockupViewModel,
  PolymerElement,
  ShortsLockupViewModel,
  VideoSnapshot
} from "../types";
import { isInViewport } from "./animations";
import { scheduleLazyUpdate } from "./lazy-update";
import { findItemElement } from "./query";
import { findRichItemIndex } from "./rich-item";

const FETCH_CHUNK_SIZE = 8192;
const THUMBNAIL_FADE_DURATION_MS = 250;

function replaceTextInShadowDom({ root, oldText, newText }: {
  root: ShadowRoot | Element;
  oldText: string;
  newText: string;
}) {
  if (!oldText) {
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node !== null) {
    if (node.nodeValue === oldText) {
      node.nodeValue = newText;
    }

    node = walker.nextNode();
  }
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) {
      replaceTextInShadowDom({
        root: el.shadowRoot,
        oldText,
        newText
      });
    }
  }
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

function videoIdFromThumbnailUrl(url: string) {
  return /\/vi(?:_webp)?\/([^/]+)\//.exec(url)?.[1] ?? null;
}

async function areThumbnailsDifferent({ currentSrc, newSrc }: {
  currentSrc: string;
  newSrc: string;
}) {
  if (currentSrc.split("?")[0] === newSrc.split("?")[0]) {
    return false;
  }

  const currentVideoId = videoIdFromThumbnailUrl(currentSrc);
  const newVideoId = videoIdFromThumbnailUrl(newSrc);
  if (currentVideoId !== null && currentVideoId === newVideoId) {
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

async function dissolveToNewThumbnail({
  elImg,
  newUrl,
  elItem,
  afterComplete
}: {
  elImg: HTMLImageElement;
  newUrl: string;
  elItem: HTMLElement;
  afterComplete?: () => void;
}) {
  if (elItem.matches(":hover")) {
    return;
  }

  await new Promise<void>(resolve => {
    const preload = new Image();
    preload.onload = () => resolve();
    preload.onerror = () => resolve();
    preload.src = newUrl;
  });

  if (elItem.matches(":hover")) {
    return;
  }

  const fadeOut = elImg.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    {
      duration: THUMBNAIL_FADE_DURATION_MS,
      easing: "ease",
      fill: "forwards"
    }
  );
  await fadeOut.finished;

  elImg.src = newUrl;
  afterComplete?.();

  elImg.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    {
      duration: THUMBNAIL_FADE_DURATION_MS,
      easing: "ease"
    }
  );
  fadeOut.cancel();
}

function mutateLockupViewModelInPlace({ existing, incoming, preserveContentImage }: {
  existing: LockupViewModel;
  incoming: LockupViewModel;
  preserveContentImage: boolean;
}) {
  const existingAvatarImage = existing.metadata?.lockupMetadataViewModel?.image;
  const incomingAvatarImage = incoming.metadata?.lockupMetadataViewModel?.image;
  const preservedContentImage = existing.contentImage;

  Object.assign(existing, incoming);

  if (preserveContentImage) {
    existing.contentImage = preservedContentImage;
  }

  if (
    incomingAvatarImage === undefined
    && existingAvatarImage !== undefined
    && existing.metadata?.lockupMetadataViewModel
  ) {
    existing.metadata = {
      ...existing.metadata,
      lockupMetadataViewModel: {
        ...existing.metadata.lockupMetadataViewModel,
        image: existingAvatarImage
      }
    };
  }
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

    const contents = deepArray(elGrid.data, "contents");
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

    const contents = deepArray(elShelf.data, "contents");
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

function mergeLockupViewModel({ existing, incoming, forcePreserveContentImage = false }: {
  existing: LockupViewModel;
  incoming: LockupViewModel;
  forcePreserveContentImage?: boolean;
}) {
  const isSameThumbnail = forcePreserveContentImage || (
    existing.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url?.split("?")[0] ===
    incoming.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url?.split("?")[0]
  );
  const existingAvatarImage = existing.metadata?.lockupMetadataViewModel?.image;
  const incomingAvatarImage = incoming.metadata?.lockupMetadataViewModel?.image;
  const mergedLockupMeta = incoming.metadata?.lockupMetadataViewModel !== undefined || existingAvatarImage !== undefined
    ? {
      ...incoming.metadata?.lockupMetadataViewModel,
      image: incomingAvatarImage ?? existingAvatarImage
    }
    : undefined;
  const mergedContentImage = isSameThumbnail ? existing.contentImage : incoming.contentImage;
  return {
    ...incoming,
    contentImage: mergedContentImage,
    metadata: mergedLockupMeta !== undefined
      ? {
        ...incoming.metadata,
        lockupMetadataViewModel: mergedLockupMeta
      }
      : incoming.metadata
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
  } else if (isRecord(content.lockupViewModel)) {
    const existing = content.lockupViewModel as unknown as LockupViewModel;
    const incoming = rawRenderer as LockupViewModel;
    const merged = mergeLockupViewModel({
      existing,
      incoming
    });
    const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
    if (elLockup && "lockupViewModel" in elLockup) {
      (elLockup as HTMLElement & { lockupViewModel: LockupViewModel }).lockupViewModel = merged;
    } else {
      elItem.set("data", {
        ...itemData,
        content: {
          ...content,
          lockupViewModel: merged
        }
      });
    }
  } else if (isRecord(content.shortsLockupViewModel)) {
    const elShortsLockup = elItem.querySelector<HTMLElement>("yt-shorts-lockup-view-model");
    if (elShortsLockup && "shortsLockupViewModel" in elShortsLockup) {
      (elShortsLockup as HTMLElement & {
        shortsLockupViewModel: ShortsLockupViewModel;
      }).shortsLockupViewModel = rawRenderer as ShortsLockupViewModel;
    } else {
      elItem.set("data", {
        ...itemData,
        content: {
          ...content,
          shortsLockupViewModel: rawRenderer
        }
      });
    }
  } else if (isRecord(content.videoRenderer)) {
    elItem.set("data.content.videoRenderer", rawRenderer);
  } else if (isRecord(content.gridVideoRenderer)) {
    elItem.set("data.content.gridVideoRenderer", rawRenderer);
  } else {
    const richGridMedia = deepRecord(content, "richGridMediaRenderer");
    if (richGridMedia) {
      elItem.set("data.content.richGridMediaRenderer.content.videoRenderer", rawRenderer);
    }
  }
}

function buildMergedVideoRenderer({
  existing,
  incoming,
  forcePreserveContentImage
}: {
  existing: Record<string, unknown> | null;
  incoming: VideoSnapshot["rawRenderer"];
  forcePreserveContentImage: boolean;
}) {
  if (!forcePreserveContentImage || existing === null || !isVideoRenderer(incoming)) {
    return incoming;
  }

  return {
    ...incoming,
    thumbnail: existing.thumbnail as InnerTubeVideoRenderer["thumbnail"]
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
  existingContent: Record<string, unknown>;
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

function syncGridModelItem({ videoId, rawRenderer, forcePreserveContentImage = false }: {
  videoId: string;
  rawRenderer: VideoSnapshot["rawRenderer"];
  forcePreserveContentImage?: boolean;
}) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data)) {
    const contents = deepArray(elGrid.data, "contents");
    const iItem = findRichItemIndex({
      contents,
      videoId
    });
    if (iItem >= 0) {
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

      return;
    }
  }

  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf) || !isRecord(elShelf.data)) {
      continue;
    }

    const contents = deepArray(elShelf.data, "contents");
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
      const items = deepArray(shelfContent, listKey, "items");
      for (const [iItem, item] of items.entries()) {
        const rendererKey = deepString(item, "videoRenderer", "videoId") === videoId ? "videoRenderer"
          : deepString(item, "gridVideoRenderer", "videoId") === videoId ? "gridVideoRenderer"
            : null;
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

function applyTargetedGenericUpdate({ videoId, elItem, previous, fresh }: {
  videoId: string;
  elItem: PolymerElement;
  previous: VideoSnapshot;
  fresh: VideoSnapshot;
}) {
  if (previous.title !== fresh.title) {
    replaceTextInShadowDom({
      root: elItem,
      oldText: previous.title,
      newText: fresh.title
    });
  }

  if (previous.viewCountText !== fresh.viewCountText) {
    replaceTextInShadowDom({
      root: elItem,
      oldText: previous.viewCountText,
      newText: fresh.viewCountText
    });
  }

  if (previous.publishedTimeText !== fresh.publishedTimeText) {
    replaceTextInShadowDom({
      root: elItem,
      oldText: previous.publishedTimeText,
      newText: fresh.publishedTimeText
    });
  }

  if (previous.thumbnailUrl === fresh.thumbnailUrl) {
    return;
  }

  const elImg = findThumbnailImgInItem(elItem);
  if (!elImg) {
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

  void areThumbnailsDifferent({
    currentSrc: elImg.src,
    newSrc: fresh.thumbnailUrl
  }).then(isDifferent => {
    if (!isDifferent) {
      syncGridModelItem({
        videoId,
        rawRenderer: fresh.rawRenderer,
        forcePreserveContentImage: true
      });
      return;
    }

    void dissolveToNewThumbnail({
      elImg,
      newUrl: fresh.thumbnailUrl,
      elItem,
      afterComplete: () => syncGridModelItem({
        videoId,
        rawRenderer: fresh.rawRenderer
      })
    });
  });
}

function applyTargetedLockupUpdate({
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
  if (previous.title !== fresh.title) {
    replaceTextInShadowDom({
      root: elItem,
      oldText: previous.title,
      newText: fresh.title
    });
  }

  if (previous.viewCountText !== fresh.viewCountText) {
    replaceTextInShadowDom({
      root: elItem,
      oldText: previous.viewCountText,
      newText: fresh.viewCountText
    });
  }

  if (previous.publishedTimeText !== fresh.publishedTimeText) {
    replaceTextInShadowDom({
      root: elItem,
      oldText: previous.publishedTimeText,
      newText: fresh.publishedTimeText
    });
  }

  const freshRawRenderer = fresh.rawRenderer;
  const freshLockup = isLockupViewModel(freshRawRenderer) ? freshRawRenderer : null;  if (previous.thumbnailUrl === fresh.thumbnailUrl) {
    if (freshLockup) {
      mutateLockupMetadata({
        videoId,
        elItem,
        incoming: freshLockup,
        preserveContentImage: true
      });
    }

    return;
  }

  const newUrl = freshLockup?.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url ?? fresh.thumbnailUrl;
  const elImg = findThumbnailImg(elLockup);
  if (!elImg) {
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

  void areThumbnailsDifferent({
    currentSrc: elImg.src,
    newSrc: newUrl
  }).then(isDifferent => {
    if (!isDifferent) {
      if (freshLockup) {
        mutateLockupMetadata({
          videoId,
          elItem,
          incoming: freshLockup,
          preserveContentImage: true
        });
      }

      return;
    }

    void dissolveToNewThumbnail({
      elImg,
      newUrl,
      elItem,
      afterComplete() {
        if (freshLockup) {
          mutateLockupMetadata({
            videoId,
            elItem,
            incoming: freshLockup,
            preserveContentImage: false
          });
        }
      }
    });
  });
}

export function applyUpdate({ videoId, elItem, fresh, previous }: {
  videoId: string;
  elItem: PolymerElement;
  fresh: VideoSnapshot;
  previous?: VideoSnapshot;
}) {
  if (!previous || previous.status !== fresh.status) {
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
  if (isRecord(content) && isRecord(content.lockupViewModel)) {
    const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
    if (elLockup) {
      applyTargetedLockupUpdate({
        videoId,
        elItem,
        elLockup,
        previous,
        fresh
      });
      return;
    }
  }

  applyTargetedGenericUpdate({
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
