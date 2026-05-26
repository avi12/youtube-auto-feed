import {
  isLockupViewModel,
  isRichShelfRenderer,
  isShelfRenderer,
  isShortsLockupViewModel,
  isVideoRenderer
} from "../api/guards";
import { parseLockupViewModel, parseRenderer, parseShortsLockupViewModel } from "../api/parse-video";
import { isPolymerElement, isRecord, videoIdFromData } from "../helpers";
import { type Prettify, type VideoSnapshot, VideoStatus } from "../types";

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

// A video can render twice (Latest band + a rich shelf like "Most relevant"); callers that
// mutate per-element DOM (metadata updates) need every copy.
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

function parseRichItemRenderer({ rawRenderer, sectionTitle, bandIndex }: Prettify<SectionContext> & {
  rawRenderer: Record<string, unknown> | null;
}) {
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

export function readDomSnapshot() {
  const snapshot = new Map<string, Prettify<VideoSnapshot>>();

  function addRichItemToSnapshot({ elItem, sectionTitle, bandIndex }: Prettify<SectionContext> & {
    elItem: Element;
  }) {
    if (!isPolymerElement(elItem)) {
      return;
    }

    const itemData = elItem.data;
    const content = isRecord(itemData) && isRecord(itemData.content) ? itemData.content : null;
    const richGridInner = isRecord(content?.richGridMediaRenderer) && isRecord(content.richGridMediaRenderer.content)
      ? content.richGridMediaRenderer.content
      : null;
    // Renderer shape varies; try each known wrapper in priority order
    const rawRendererCandidate =
      content?.videoRenderer ??
      content?.gridVideoRenderer ??
      richGridInner?.videoRenderer ??
      content?.lockupViewModel ??
      content?.shortsLockupViewModel;
    const rawRenderer = isRecord(rawRendererCandidate) ? rawRendererCandidate : null;
    const videoSnapshot = parseRichItemRenderer({
      rawRenderer,
      sectionTitle,
      bandIndex
    });
    const isAlreadyCaptured = !videoSnapshot || snapshot.has(videoSnapshot.videoId);
    if (isAlreadyCaptured) {
      return;
    }

    snapshot.set(videoSnapshot.videoId, videoSnapshot);
  }

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
        bandIndex: 0
      });
    }
  }

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
      const isAlreadyCaptured = !videoSnapshot || snapshot.has(videoSnapshot.videoId);
      if (isAlreadyCaptured) {
        continue;
      }

      snapshot.set(videoSnapshot.videoId, videoSnapshot);
    }
  }

  const elGridContents = document.querySelector("ytd-rich-grid-renderer > #contents");
  if (elGridContents) {
    let currentSectionTitle = "";
    let currentBandIndex = 0;
    for (const elChild of elGridContents.children) {
      if (elChild.tagName === "YTD-RICH-SECTION-RENDERER") {
        currentSectionTitle = "";
        const elRichShelf = elChild.querySelector("ytd-rich-shelf-renderer");
        const elInnerShelf = elChild.querySelector("ytd-shelf-renderer");
        // Title-only legacy shelves still mark a band boundary even with no inline contents
        const hasInnerShelfVideos = elInnerShelf !== null
          && elInnerShelf.querySelectorAll("ytd-grid-video-renderer, ytd-video-renderer").length > 0;
        const isContentBearingSection = elRichShelf !== null || hasInnerShelfVideos;
        if (isContentBearingSection) {
          currentBandIndex++;
        }
      } else if (elChild.tagName === "YTD-RICH-ITEM-RENDERER") {
        addRichItemToSnapshot({
          elItem: elChild,
          sectionTitle: currentSectionTitle,
          bandIndex: currentBandIndex
        });
      }
    }
  }

  // Fallback for legacy grid-only layouts (no rich-grid-renderer)
  if (snapshot.size === 0) {
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

  return snapshot;
}

export function leadingLiveCount({ elShelf, snapshot }: {
  elShelf: Element;
  snapshot: Map<string, Prettify<VideoSnapshot>>;
}) {
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
