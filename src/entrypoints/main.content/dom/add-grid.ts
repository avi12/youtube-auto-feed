import {
  assignItemViewTransitionNames,
  buildNewItemTransitionStyle,
  buildShiftTransitionStyle,
  calculateStaggerDelayMs,
  clearAllItemViewTransitionNames,
  clearItemViewTransitionNames,
  extractAnimateIds,
  reassignTransitionNames
} from "./animations";
import { isVideoRenderer } from "../api/guards";
import {
  deepArray, deepRecord, deepString, isPolymerElement, isRecord, videoIdFromData
} from "../helpers";
import { VideoStatus, type VideoSnapshot } from "../types";
import { addSectionToDom } from "./add-section";
import { buildRichItem } from "./build";
import { findItemElement } from "./query";
import { sortByFreshOrder, videoIdFromRichItem } from "./rich-item";

export async function addVideosToGridDom(videosToAdd: VideoSnapshot[], allFreshSnapshots: VideoSnapshot[]) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid)) {
    const processedSectionTitles = new Set<string>();
    for (const { sectionTitle } of videosToAdd) {
      if (processedSectionTitles.has(sectionTitle)) {
        continue;
      }

      processedSectionTitles.add(sectionTitle);
      await addSectionToDom(sectionTitle, allFreshSnapshots.filter(video => video.sectionTitle === sectionTitle));
    }
    return;
  }

  if (!isRecord(elGrid.data)) {
    return;
  }

  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  if (!elGridContents) {
    return;
  }

  const freshOrderMap = new Map(allFreshSnapshots.map((video, i) => [video.videoId, i]));
  const allSnapshotMap = new Map(allFreshSnapshots.map(video => [video.videoId, video]));
  const sortedVideos = sortByFreshOrder(videosToAdd, freshOrderMap);

  const standaloneVideos = sortedVideos.filter(video => !video.sectionTitle);

  const actuallyAddedVideos: VideoSnapshot[] = [];
  const elNewItemTransitionStyles: HTMLStyleElement[] = [];

  clearAllItemViewTransitionNames();

  const elAllItems = [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")];
  const shiftTargets = standaloneVideos.length > 0
    ? collectGridShiftTargets(elGridContents, elAllItems, standaloneVideos, freshOrderMap)
    : null;
  const elElementsToAnimate = shiftTargets?.elElementsToAnimate ?? [];
  const elSectionsToAnimate = shiftTargets?.elSectionsToAnimate ?? [];

  assignItemViewTransitionNames(elElementsToAnimate);
  const elShiftStyle = buildShiftTransitionStyle(elElementsToAnimate, new Set(), calculateStaggerDelayMs(elElementsToAnimate.length));
  document.head.append(elShiftStyle);

  const animateIds = extractAnimateIds(elElementsToAnimate);

  try {
    await document.startViewTransition(async () => {
      const newContents = [...deepArray(elGrid.data, "contents")];

      const findExistingSectionIndex = (sectionTitle: string) => sectionTitle ? newContents.findIndex(item =>
        deepString(item, "richSectionRenderer", "content", "richShelfRenderer", "title", "runs", "0", "text") === sectionTitle ||
        deepString(item, "richSectionRenderer", "content", "shelfRenderer", "title", "runs", "0", "text") === sectionTitle
      ) : -1;

      // Group videos that need a brand-new section created
      const newSectionGroups = new Map<string, VideoSnapshot[]>();
      const videosForNormalPath: VideoSnapshot[] = [];
      for (const video of sortedVideos) {
        if (video.sectionTitle && findExistingSectionIndex(video.sectionTitle) < 0) {
          const group = newSectionGroups.get(video.sectionTitle) ?? [];
          group.push(video);
          newSectionGroups.set(video.sectionTitle, group);
        } else {
          videosForNormalPath.push(video);
        }
      }

      // Insert new sections at the position determined by fresh order
      for (const [sectionTitle, sectionVideos] of newSectionGroups) {
        const sectionMinimumFreshIndex = sectionVideos.reduce(
          (minimum, sectionVideo) => Math.min(minimum, freshOrderMap.get(sectionVideo.videoId) ?? Infinity),
          Infinity
        );
        const iInsert = findSectionInsertIndex(newContents, sectionMinimumFreshIndex, freshOrderMap);
        newContents.splice(iInsert, 0, buildNewRichSection(sectionTitle, sectionVideos));
      }

      // Add videos to existing sections or as standalone items
      for (const video of videosForNormalPath) {
        const { videoId, rawRenderer, sectionTitle } = video;
        const iSection = findExistingSectionIndex(sectionTitle);

        let wasInserted = false;
        if (iSection >= 0) {
          const section = deepRecord(newContents[iSection], "richSectionRenderer");
          const content = deepRecord(section, "content");
          const richShelf = deepRecord(content, "richShelfRenderer");
          if (section && content && richShelf) {
            const shelfContents = deepArray(richShelf, "contents");
            if (!shelfContents.some(item => videoIdFromRichItem(item) === videoId)) {
              newContents[iSection] = {
                richSectionRenderer: {
                  ...section,
                  content: {
                    ...content,
                    richShelfRenderer: { ...richShelf, contents: [buildRichItem(rawRenderer), ...shelfContents] }
                  }
                }
              };
            }
            wasInserted = true;
          } else if (section && content) {
            const innerShelf = deepRecord(content, "shelfRenderer");
            const innerContent = deepRecord(innerShelf, "content");
            if (innerShelf && isVideoRenderer(rawRenderer) && innerContent) {
              const horizontalList = deepRecord(innerContent, "horizontalListRenderer");
              const gridList = deepRecord(innerContent, "gridRenderer");
              const listKey = !horizontalList && gridList ? "gridRenderer" : "horizontalListRenderer";
              const existingList: Record<string, unknown> = horizontalList ?? gridList ?? {};
              const items = deepArray(existingList, "items");
              const isAlreadyPresent = items.some(item =>
                deepString(item, "videoRenderer", "videoId") === videoId ||
                deepString(item, "gridVideoRenderer", "videoId") === videoId
              );
              if (!isAlreadyPresent) {
                newContents[iSection] = {
                  richSectionRenderer: {
                    ...section,
                    content: {
                      ...content,
                      shelfRenderer: {
                        ...innerShelf,
                        content: {
                          ...innerContent,
                          [listKey]: { ...existingList, items: [{ videoRenderer: rawRenderer }, ...items] }
                        }
                      }
                    }
                  }
                };
              }
              wasInserted = true;
            }
          }
        }

        if (!wasInserted && !newContents.some(item => videoIdFromRichItem(item) === videoId)) {
          const freshIndex = freshOrderMap.get(videoId) ?? 0;
          const iInsert = findGridInsertIndex(newContents, freshIndex, freshOrderMap, video.status, allSnapshotMap);
          newContents.splice(iInsert, 0, buildRichItem(rawRenderer));
          actuallyAddedVideos.push(video);
        }
      }

      elGrid.set("data.contents", newContents);

      for (const elItem of elElementsToAnimate) {
        if (elItem.tagName === "YTD-RICH-ITEM-RENDERER") {
          elItem.style.viewTransitionName = "";
        }
      }

      for (let i = 0; i < 10 && actuallyAddedVideos.some(video => !findItemElement(video.videoId)); i++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }

      reassignTransitionNames(elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer"), animateIds);

      const elNewItems: HTMLElement[] = [];
      for (const video of actuallyAddedVideos) {
        const elNewItem = findItemElement(video.videoId);
        if (elNewItem) {
          elNewItem.style.viewTransitionName = `ytsua-item-${video.videoId}`;
          elNewItems.push(elNewItem);
        }
      }
      if (elNewItems.length > 0) {
        const elNewItemTransitionStyle = buildNewItemTransitionStyle(elNewItems);
        document.head.append(elNewItemTransitionStyle);
        elNewItemTransitionStyles.push(elNewItemTransitionStyle);
      }
    }).finished;
  } finally {
    elShiftStyle.remove();
    elNewItemTransitionStyles[0]?.remove();
    clearItemViewTransitionNames(elElementsToAnimate);
    clearItemViewTransitionNames(elSectionsToAnimate);
    for (const video of actuallyAddedVideos) {
      const elNewItem = findItemElement(video.videoId);
      if (elNewItem) {
        elNewItem.style.viewTransitionName = "";
      }
    }
    clearAllItemViewTransitionNames();
  }

  for (const elSection of document.querySelectorAll<HTMLElement>("ytd-rich-section-renderer.ytsua-section-removing")) {
    elSection.classList.remove("ytsua-section-removing");
  }
}

function shelfRendererListItems(contentItem: unknown) {
  return [
    ...deepArray(contentItem, "richSectionRenderer", "content", "shelfRenderer", "content", "horizontalListRenderer", "items"),
    ...deepArray(contentItem, "richSectionRenderer", "content", "shelfRenderer", "content", "gridRenderer", "items")
  ];
}

export function cleanOrphanedGridItems() {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  if (!elGridContents) {
    return;
  }

  const standaloneModelIds = new Set<string>();
  const standaloneModelDuplicates = new Set<string>();
  const sectionIds = new Set<string>();

  for (const item of deepArray(elGrid.data, "contents")) {
    const topId = videoIdFromRichItem(item);
    if (topId) {
      if (standaloneModelIds.has(topId)) {
        standaloneModelDuplicates.add(topId);
      } else {
        standaloneModelIds.add(topId);
      }
    } else {
      for (const shelfItem of deepArray(item, "richSectionRenderer", "content", "richShelfRenderer", "contents")) {
        const shelfId = videoIdFromRichItem(shelfItem);
        if (shelfId) {
          sectionIds.add(shelfId);
        }
      }
      for (const listItem of shelfRendererListItems(item)) {
        const videoId = deepString(listItem, "videoRenderer", "videoId") || deepString(listItem, "gridVideoRenderer", "videoId");
        if (videoId) {
          sectionIds.add(videoId);
        }
      }
    }
  }

  const misplacedIds = new Set([...standaloneModelIds].filter(videoId => sectionIds.has(videoId)));
  if (misplacedIds.size > 0 || standaloneModelDuplicates.size > 0) {
    const seenDuplicates = new Set<string>();
    const filteredContents = deepArray(elGrid.data, "contents").filter(item => {
      const videoId = videoIdFromRichItem(item);
      if (!videoId) {
        return true;
      }

      if (misplacedIds.has(videoId)) {
        return false;
      }

      if (standaloneModelDuplicates.has(videoId)) {
        if (seenDuplicates.has(videoId)) {
          return false;
        }

        seenDuplicates.add(videoId);
      }

      return true;
    });
    elGrid.set("data.contents", filteredContents);
    for (const videoId of misplacedIds) {
      standaloneModelIds.delete(videoId);
    }
  }

  const seenDomIds = new Set<string>();
  for (const elChild of [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer, :scope > ytd-rich-section-renderer")]) {
    if (elChild.tagName !== "YTD-RICH-ITEM-RENDERER" || !isPolymerElement(elChild)) {
      continue;
    }

    const videoId = videoIdFromData(elChild.data);
    const isInModel = !!videoId && standaloneModelIds.has(videoId);
    const isDuplicate = !!videoId && seenDomIds.has(videoId);
    if (!isInModel || isDuplicate) {
      elChild.remove();
    } else {
      seenDomIds.add(videoId);
    }
  }

}

function findSectionInsertIndex(contents: unknown[], sectionMinimumFreshIndex: number, freshOrderMap: Map<string, number>) {
  for (let iContent = 0; iContent < contents.length; iContent++) {
    const item = contents[iContent];
    const standaloneId = videoIdFromRichItem(item);
    if (standaloneId) {
      if ((freshOrderMap.get(standaloneId) ?? Infinity) > sectionMinimumFreshIndex) {
        return iContent;
      }

      continue;
    }

    const existingSectionItems = deepArray(item, "richSectionRenderer", "content", "richShelfRenderer", "contents");
    if (existingSectionItems.length > 0) {
      const existingSectionMinimum = existingSectionItems.reduce((minimum, contentItem) => {
        const videoId = videoIdFromRichItem(contentItem);
        return Math.min(minimum, videoId ? (freshOrderMap.get(videoId) ?? Infinity) : Infinity);
      }, Infinity);
      if (existingSectionMinimum > sectionMinimumFreshIndex) {
        return iContent;
      }
    }
  }
  return contents.length;
}

function buildNewRichSection(sectionTitle: string, videos: VideoSnapshot[]) {
  return {
    richSectionRenderer: {
      content: {
        richShelfRenderer: {
          title: { runs: [{ text: sectionTitle }] },
          contents: videos.map(({ rawRenderer }) => buildRichItem(rawRenderer)),
          trackingParams: ""
        }
      },
      trackingParams: ""
    }
  };
}

function findGridInsertIndex(
  contents: unknown[],
  freshIndex: number,
  freshOrderMap: Map<string, number>,
  videoStatus: VideoStatus,
  allSnapshotMap: Map<string, VideoSnapshot>
) {
  let iInsert = contents.length;
  for (let i = 0; i < contents.length; i++) {
    const item = contents[i];

    if (isRecord(item) && "continuationItemRenderer" in item) {
      iInsert = i;
      break;
    }

    const existingId = videoIdFromRichItem(item);
    if (existingId) {
      if ((freshOrderMap.get(existingId) ?? Infinity) > freshIndex) {
        iInsert = i;
        break;
      }

      continue;
    }

    const sectionItems = deepArray(item, "richSectionRenderer", "content", "richShelfRenderer", "contents");
    if (sectionItems.length > 0) {
      const sectionMinFreshIndex = sectionItems.reduce((minimum, sectionItem) => {
        const sectionItemId = videoIdFromRichItem(sectionItem);
        return Math.min(minimum, sectionItemId ? (freshOrderMap.get(sectionItemId) ?? Infinity) : Infinity);
      }, Infinity);
      if (sectionMinFreshIndex > freshIndex) {
        iInsert = i;
        break;
      }
    }
  }

  if (videoStatus === VideoStatus.Live) {
    return iInsert;
  }

  let leadingLiveCount = 0;
  for (const item of contents) {
    const itemVideoId = videoIdFromRichItem(item);
    if (!itemVideoId) break;
    if (allSnapshotMap.get(itemVideoId)?.status !== VideoStatus.Live) break;
    leadingLiveCount++;
  }

  return Math.max(iInsert, leadingLiveCount);
}

function collectGridShiftTargets(
  elGridContents: HTMLElement,
  elAllItems: HTMLElement[],
  sortedVideos: VideoSnapshot[],
  freshOrderMap: Map<string, number>
) {
  const minFreshIndex = freshOrderMap.get(sortedVideos[0]?.videoId ?? "") ?? 0;
  let firstShiftingItem: HTMLElement | undefined;
  for (const elItem of elAllItems) {
    const existingId = isPolymerElement(elItem) ? videoIdFromData(elItem.data) : null;
    if ((freshOrderMap.get(existingId ?? "") ?? Infinity) >= minFreshIndex) {
      firstShiftingItem = elItem;
      break;
    }
  }

  const elElementsToAnimate: HTMLElement[] = [];
  const elSectionsToAnimate: HTMLElement[] = [];
  if (!firstShiftingItem) {
    return { elElementsToAnimate, elSectionsToAnimate };
  }

  const elChildren = elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer, :scope > ytd-rich-section-renderer");
  let isAnimating = false;
  for (let iChild = 0; iChild < elChildren.length; iChild++) {
    const elChild = elChildren[iChild];
    if (elChild === firstShiftingItem) {
      isAnimating = true;
    }

    if (!isAnimating) {
      continue;
    }

    if (elChild.getBoundingClientRect().top > innerHeight) {
      break;
    }

    elElementsToAnimate.push(elChild);
    if (elChild.tagName === "YTD-RICH-SECTION-RENDERER") {
      elChild.style.viewTransitionName = `ytsua-section-${iChild}`;
      elSectionsToAnimate.push(elChild);
    }
  }

  return { elElementsToAnimate, elSectionsToAnimate };
}

export interface BandLayout {
  sectionOrder: string[];
  bandCaps: Map<string, number>;
}

export function captureBandLayout(): BandLayout | null {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return null;
  }

  const contents = deepArray(elGrid.data, "contents");

  const sectionOrder: string[] = [];
  const bandCaps = new Map<string, number>();
  let currentBand = "";
  let itemCount = 0;

  for (const item of contents) {
    const sectionTitle = deepString(item, "richSectionRenderer", "content", "richShelfRenderer", "title", "runs", "0", "text")
      || deepString(item, "richSectionRenderer", "content", "shelfRenderer", "title", "runs", "0", "text");
    if (sectionTitle) {
      if (itemCount > 0) {
        bandCaps.set(currentBand, itemCount);
      }
      sectionOrder.push(sectionTitle);
      currentBand = sectionTitle;
      itemCount = 0;
      continue;
    }
    if (!videoIdFromRichItem(item)) {
      continue;
    }
    itemCount++;
  }
  if (itemCount > 0) {
    bandCaps.set(currentBand, itemCount);
  }
  return { sectionOrder, bandCaps };
}

export function consolidateStandaloneItems() {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const contents = [...deepArray(elGrid.data, "contents")];

  let sectionsEncountered = 0;
  let latestBandEndIndex = -1;
  for (let i = 0; i < contents.length; i++) {
    const sectionTitle = deepString(contents[i], "richSectionRenderer", "content", "richShelfRenderer", "title", "runs", "0", "text")
      || deepString(contents[i], "richSectionRenderer", "content", "shelfRenderer", "title", "runs", "0", "text");
    if (sectionTitle) {
      sectionsEncountered++;
      if (sectionsEncountered === 2) {
        latestBandEndIndex = i;
        break;
      }
    }
  }

  if (latestBandEndIndex < 0) {
    return;
  }

  const trailingItems: unknown[] = [];
  const trailingIndices = new Set<number>();
  for (let i = latestBandEndIndex; i < contents.length; i++) {
    if (videoIdFromRichItem(contents[i])) {
      trailingItems.push(contents[i]);
      trailingIndices.add(i);
    }
  }

  if (trailingItems.length === 0) {
    return;
  }

  const newContents = contents.filter((_, i) => !trailingIndices.has(i));
  newContents.splice(latestBandEndIndex, 0, ...trailingItems);
  elGrid.set("data.contents", newContents);
}

export function enforceBandLayout(layout: BandLayout) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const contents = [...deepArray(elGrid.data, "contents")];
  const preLength = contents.length;
  let currentBand = "";
  const seen = new Map<string, number>();
  const indicesToRemove: number[] = [];
  for (let i = 0; i < contents.length; i++) {
    const item = contents[i];
    const sectionTitle = deepString(item, "richSectionRenderer", "content", "richShelfRenderer", "title", "runs", "0", "text")
      || deepString(item, "richSectionRenderer", "content", "shelfRenderer", "title", "runs", "0", "text");
    if (sectionTitle) {
      currentBand = sectionTitle;
      continue;
    }
    if (!videoIdFromRichItem(item)) {
      continue;
    }
    const count = (seen.get(currentBand) ?? 0) + 1;
    seen.set(currentBand, count);
    const cap = layout.bandCaps.get(currentBand);
    if (cap !== undefined && count > cap) {
      indicesToRemove.push(i);
    }
  }
  for (let i = indicesToRemove.length - 1; i >= 0; i--) {
    contents.splice(indicesToRemove[i], 1);
  }
  if (contents.length < preLength) {
    elGrid.set("data.contents", contents);
  }
}
