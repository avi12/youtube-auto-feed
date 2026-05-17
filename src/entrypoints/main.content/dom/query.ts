import { isLockupViewModel, isShortsLockupViewModel, isVideoRenderer } from "../api/guards";
import { parseLockupViewModel, parseRenderer, parseShortsLockupViewModel } from "../api/parse-video";
import { deepRecord, deepString, isPolymerElement, videoIdFromData } from "../helpers";
import { type VideoSnapshot, VideoStatus } from "../types";

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

    if (deepString(elItem.data, "videoId") === videoId) {
      return elItem;
    }
  }
  return null;
}

export function findShelfForSection(sectionTitle: string) {
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    if (deepString(elShelf.data, "title", "runs", "0", "text") === sectionTitle) {
      return elShelf;
    }
  }
  return null;
}

export function readDomSnapshot() {
  const snapshot = new Map<string, VideoSnapshot>();

  function addRichItemToSnapshot(elItem: Element, sectionTitle: string) {
    if (!isPolymerElement(elItem)) {
      return;
    }

    const rawRenderer =
      deepRecord(elItem.data, "content", "videoRenderer") ??
      deepRecord(elItem.data, "content", "gridVideoRenderer") ??
      deepRecord(elItem.data, "content", "richGridMediaRenderer", "content", "videoRenderer") ??
      deepRecord(elItem.data, "content", "lockupViewModel") ??
      deepRecord(elItem.data, "content", "shortsLockupViewModel");
    let videoSnapshot = null;
    if (isVideoRenderer(rawRenderer)) {
      videoSnapshot = parseRenderer(rawRenderer, sectionTitle);
    } else if (isLockupViewModel(rawRenderer)) {
      videoSnapshot = parseLockupViewModel(rawRenderer, sectionTitle);
    } else if (isShortsLockupViewModel(rawRenderer)) {
      videoSnapshot = parseShortsLockupViewModel(rawRenderer, sectionTitle);
    }

    if (videoSnapshot && !snapshot.has(videoSnapshot.videoId)) {
      snapshot.set(videoSnapshot.videoId, videoSnapshot);
    }
  }

  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    const sectionTitle = deepString(elShelf.data, "title", "runs", "0", "text");
    for (const elItem of elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
      addRichItemToSnapshot(elItem, sectionTitle);
    }
  }

  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    const sectionTitle = deepString(elShelf.data, "title", "runs", "0", "text");
    for (const elItem of elShelf.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
      if (!isPolymerElement(elItem)) {
        continue;
      }

      const rawRenderer = elItem.data;
      if (!isVideoRenderer(rawRenderer)) {
        continue;
      }

      const videoSnapshot = parseRenderer(rawRenderer, sectionTitle);
      if (videoSnapshot && !snapshot.has(videoSnapshot.videoId)) {
        snapshot.set(videoSnapshot.videoId, videoSnapshot);
      }
    }
  }

  const elGridContents = document.querySelector("ytd-rich-grid-renderer > #contents");
  if (elGridContents) {
    let currentSectionTitle = "";
    for (const elChild of elGridContents.children) {
      if (elChild.tagName === "YTD-RICH-SECTION-RENDERER") {
        currentSectionTitle = "";
      } else if (elChild.tagName === "YTD-RICH-ITEM-RENDERER") {
        addRichItemToSnapshot(elChild, currentSectionTitle);
      }
    }
  }

  if (snapshot.size === 0) {
    for (const elGridVideo of document.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
      if (!isPolymerElement(elGridVideo)) {
        continue;
      }

      const gridVideoData = elGridVideo.data;
      if (!isVideoRenderer(gridVideoData)) {
        continue;
      }

      const videoSnapshot = parseRenderer(gridVideoData, "");
      if (videoSnapshot) {
        snapshot.set(videoSnapshot.videoId, videoSnapshot);
      }
    }
  }

  return snapshot;
}

export function leadingLiveCount(elShelf: Element, snapshot: Map<string, VideoSnapshot>) {
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
