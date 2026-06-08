import type { Prettify } from "../types/prettify";
import { type VideoSnapshot, VideoStatus } from "../types/video";
import { isPolymerElement } from "../utils/polymer";
import { videoIdFromData } from "../utils/video-id";
import {
  isLockupViewModel,
  isRichShelfRenderer,
  isShelfRenderer,
  isShortsLockupViewModel,
  isVideoRenderer
} from "../youtube-api/guards";
import { parseLockupViewModel, parseRenderer, parseShortsLockupViewModel } from "../youtube-api/parse-video";
import { richItemDataSchema } from "../youtube-api/schemas";

// Reads the DOM into a VideoSnapshot map for the diff layer, plus element-lookup helpers for
// finding items by video ID and shelves by section name.

interface SectionContext {
  sectionTitle: string;
  bandIndex: number;
}

export function findItemElement(videoId: string) {
  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    if (videoIdFromData(elItem.data) === videoId) {
      return elItem;
    }
  }

  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const gridVideoData = elItem.data;
    const isMatchingGridVideo = isVideoRenderer(gridVideoData) && gridVideoData.videoId === videoId;
    if (isMatchingGridVideo) {
      return elItem;
    }
  }
  return null;
}

// A video can render in two places (Latest band + a rich shelf); metadata mutation callers need
// every copy.
export function findItemElements(videoId: string) {
  const elements: HTMLElement[] = [];
  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    if (videoIdFromData(elItem.data) === videoId) {
      elements.push(elItem);
    }
  }

  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const gridVideoData = elItem.data;
    const isMatchingGridVideo = isVideoRenderer(gridVideoData) && gridVideoData.videoId === videoId;
    if (isMatchingGridVideo) {
      elements.push(elItem);
    }
  }
  return elements;
}

export function findShelfForSection(sectionTitle: string) {
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    const shelfData = elShelf.data;
    const isMatchingShelf = isRichShelfRenderer(shelfData)
      && (shelfData.title?.runs?.[0]?.text ?? "") === sectionTitle;
    if (isMatchingShelf) {
      return elShelf;
    }
  }
  return null;
}

type ParseRichItemRendererParams = Prettify<SectionContext & {
  rawRenderer: Record<string, unknown> | null;
}>;

function parseRichItemRenderer({ rawRenderer, sectionTitle, bandIndex }: ParseRichItemRendererParams) {
  if (isVideoRenderer(rawRenderer)) {
    return parseRenderer({
      renderer: rawRenderer,
      sectionTitle,
      bandIndex
    });
  }

  if (isLockupViewModel(rawRenderer)) {
    return parseLockupViewModel({
      lockup: rawRenderer,
      sectionTitle,
      bandIndex
    });
  }

  if (isShortsLockupViewModel(rawRenderer)) {
    return parseShortsLockupViewModel({
      shortsLockup: rawRenderer,
      sectionTitle,
      bandIndex
    });
  }

  return null;
}

type AddRichItemToSnapshotParams = Prettify<SectionContext & {
  elItem: Element;
  snapshot: Map<string, Prettify<VideoSnapshot>>;
}>;

function addRichItemToSnapshot({ elItem, sectionTitle, bandIndex, snapshot }: AddRichItemToSnapshotParams) {
  if (!isPolymerElement(elItem)) {
    return;
  }

  const parsed = richItemDataSchema.safeParse(elItem.data);
  const content = parsed.success ? parsed.data.content : undefined;
  if (!content) {
    return;
  }

  // Try each known renderer wrapper in priority order - shape varies by item type.
  const rawRenderer = content.videoRenderer
    ?? content.gridVideoRenderer
    ?? content.richGridMediaRenderer?.content?.videoRenderer
    ?? content.lockupViewModel
    ?? content.shortsLockupViewModel
    ?? null;
  const videoSnapshot = parseRichItemRenderer({
    rawRenderer,
    sectionTitle,
    bandIndex
  });
  if (!videoSnapshot || snapshot.has(videoSnapshot.videoId)) {
    return;
  }

  snapshot.set(videoSnapshot.videoId, videoSnapshot);
}

function collectRichShelfVideos(snapshot: Map<string, Prettify<VideoSnapshot>>) {
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    const shelfData = elShelf.data;
    const sectionTitle = isRichShelfRenderer(shelfData) ? shelfData.title?.runs?.[0]?.text ?? "" : "";
    for (const elItem of elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
      addRichItemToSnapshot({
        elItem,
        sectionTitle,
        bandIndex: 0,
        snapshot
      });
    }
  }
}

function collectLegacyShelfVideos(snapshot: Map<string, Prettify<VideoSnapshot>>) {
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    const shelfData = elShelf.data;
    const sectionTitle = isShelfRenderer(shelfData) ? shelfData.title?.runs?.[0]?.text ?? "" : "";
    for (const elItem of elShelf.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
      if (!isPolymerElement(elItem)) {
        continue;
      }

      const rawRenderer = elItem.data;
      if (!isVideoRenderer(rawRenderer)) {
        continue;
      }

      const videoSnapshot = parseRenderer({
        renderer: rawRenderer,
        sectionTitle,
        bandIndex: 0
      });
      if (!videoSnapshot || snapshot.has(videoSnapshot.videoId)) {
        continue;
      }

      snapshot.set(videoSnapshot.videoId, videoSnapshot);
    }
  }
}

function collectInlineGridVideos(snapshot: Map<string, Prettify<VideoSnapshot>>) {
  const elGridContents = document.querySelector("ytd-rich-grid-renderer > #contents");
  if (!elGridContents) {
    return;
  }

  let currentSectionTitle = "";
  let currentBandIndex = 0;
  for (const elChild of elGridContents.children) {
    if (elChild.tagName === "YTD-RICH-SECTION-RENDERER") {
      currentSectionTitle = "";
      const elRichShelf = elChild.querySelector("ytd-rich-shelf-renderer");
      const elInnerShelf = elChild.querySelector("ytd-shelf-renderer");
      // Title-only legacy shelves mark a band boundary even without inline video contents.
      const hasInnerShelfVideos = elInnerShelf !== null
        && elInnerShelf.querySelectorAll("ytd-grid-video-renderer, ytd-video-renderer").length > 0;
      if (elRichShelf !== null || hasInnerShelfVideos) {
        currentBandIndex++;
      }

      continue;
    }

    if (elChild.tagName === "YTD-RICH-ITEM-RENDERER") {
      addRichItemToSnapshot({
        elItem: elChild,
        sectionTitle: currentSectionTitle,
        bandIndex: currentBandIndex,
        snapshot
      });
    }
  }
}

function collectFallbackGridVideos(snapshot: Map<string, Prettify<VideoSnapshot>>) {
  for (const elGridVideo of document.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
    if (!isPolymerElement(elGridVideo)) {
      continue;
    }

    const gridVideoData = elGridVideo.data;
    if (!isVideoRenderer(gridVideoData)) {
      continue;
    }

    const videoSnapshot = parseRenderer({
      renderer: gridVideoData,
      sectionTitle: "",
      bandIndex: 0
    });
    if (videoSnapshot) {
      snapshot.set(videoSnapshot.videoId, videoSnapshot);
    }
  }
}

export function readDomSnapshot() {
  const snapshot = new Map<string, Prettify<VideoSnapshot>>();

  collectRichShelfVideos(snapshot);
  collectLegacyShelfVideos(snapshot);
  collectInlineGridVideos(snapshot);

  // Fallback for legacy grid-only layouts that lack a rich-grid-renderer.
  if (snapshot.size === 0) {
    collectFallbackGridVideos(snapshot);
  }

  return snapshot;
}

type LeadingLiveCountParams = Prettify<{
  elShelf: Element;
  snapshot: Map<string, Prettify<VideoSnapshot>>;
}>;

export function leadingLiveCount({ elShelf, snapshot }: LeadingLiveCountParams) {
  let count = 0;
  for (const elItem of elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    if (!isPolymerElement(elItem)) {
      break;
    }

    const videoId = videoIdFromData(elItem.data);
    const videoSnapshot = videoId ? snapshot.get(videoId) : null;
    if (videoSnapshot?.status !== VideoStatus.Live) {
      break;
    }

    count++;
  }
  return count;
}
