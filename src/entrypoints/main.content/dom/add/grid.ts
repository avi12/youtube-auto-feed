import {
  assignItemViewTransitionNames,
  buildNewItemTransitionStyle,
  buildShiftTransitionStyle,
  calculateStaggerDelayMs,
  clearAllItemViewTransitionNames,
  clearItemViewTransitionNames,
  extractAnimateIds,
  reassignTransitionNames,
  waitForFrames
} from "../animations";
import { isVideoRenderer } from "../../api/guards";
import {
  deepArray, deepRecord, deepString, isPolymerElement, isRecord, videoIdFromData, videoIdFromShelfListItem
} from "../../helpers";
import { type PolymerElement, type VideoSnapshot, VideoStatus } from "../../types";
import { addSectionToDom } from "./section";
import { buildRichItem } from "../build";
import { findItemElement } from "../query";
import { sortByFreshOrder, videoIdFromRichItem } from "../rich-item";

export async function addVideosToGridDom(videosToAdd: VideoSnapshot[], allFreshSnapshots: VideoSnapshot[]) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid)) {
    await fallbackAddBySection(videosToAdd, allFreshSnapshots);
    return;
  }
  if (!isRecord(elGrid.data)) return;

  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  if (!elGridContents) return;

  const freshOrderMap = new Map(allFreshSnapshots.map((video, i) => [video.videoId, i]));
  const allSnapshotMap = new Map(allFreshSnapshots.map(video => [video.videoId, video]));
  const sortedVideos = sortByFreshOrder(videosToAdd, freshOrderMap);
  const standaloneVideos = sortedVideos.filter(video => !video.sectionTitle);

  const transitionContext = setupGridTransition(elGridContents, standaloneVideos, freshOrderMap);

  try {
    await document.startViewTransition(async () => {
      const actuallyAddedVideos = applyVideoInsertions(elGrid, sortedVideos, freshOrderMap, allSnapshotMap);
      transitionContext.actuallyAddedVideos = actuallyAddedVideos;

      const elNewItems = await applyNewItemAnimations(
        elGridContents,
        transitionContext.elElementsToAnimate,
        actuallyAddedVideos,
        transitionContext.animateIds
      );
      if (elNewItems.length > 0) {
        const elStyle = buildNewItemTransitionStyle(elNewItems);
        document.head.append(elStyle);
        transitionContext.elNewItemTransitionStyles.push(elStyle);
      }
    }).finished;
  } finally {
    teardownGridTransition(transitionContext);
  }

  for (const elSection of document.querySelectorAll<HTMLElement>("ytd-rich-section-renderer.ytsua-section-removing")) {
    elSection.classList.remove("ytsua-section-removing");
  }
}

export function cleanOrphanedGridItems() {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) return;

  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  if (!elGridContents) return;

  const { standaloneModelIds, standaloneModelDuplicates, sectionIds } = collectGridModelIds(elGrid);
  const misplacedIds = new Set([...standaloneModelIds].filter(videoId => sectionIds.has(videoId)));

  if (misplacedIds.size > 0 || standaloneModelDuplicates.size > 0) {
    filterMisplacedAndDuplicates(elGrid, misplacedIds, standaloneModelDuplicates);
    for (const videoId of misplacedIds) {
      standaloneModelIds.delete(videoId);
    }
  }

  pruneOrphanedDomItems(elGridContents, standaloneModelIds);
}

interface GridTransitionContext {
  elShiftStyle: HTMLStyleElement;
  elElementsToAnimate: HTMLElement[];
  elSectionsToAnimate: HTMLElement[];
  animateIds: Set<string>;
  elNewItemTransitionStyles: HTMLStyleElement[];
  actuallyAddedVideos: VideoSnapshot[];
}

function setupGridTransition(
  elGridContents: HTMLElement,
  standaloneVideos: VideoSnapshot[],
  freshOrderMap: Map<string, number>
): GridTransitionContext {
  clearAllItemViewTransitionNames();

  const elAllItems = [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")];
  const shiftTargets = standaloneVideos.length > 0
    ? collectGridShiftTargets(elGridContents, elAllItems, standaloneVideos, freshOrderMap)
    : { elElementsToAnimate: [], elSectionsToAnimate: [] };

  assignItemViewTransitionNames(shiftTargets.elElementsToAnimate);
  const elShiftStyle = buildShiftTransitionStyle(
    shiftTargets.elElementsToAnimate,
    new Set(),
    calculateStaggerDelayMs(shiftTargets.elElementsToAnimate.length)
  );
  document.head.append(elShiftStyle);

  return {
    elShiftStyle,
    elElementsToAnimate: shiftTargets.elElementsToAnimate,
    elSectionsToAnimate: shiftTargets.elSectionsToAnimate,
    animateIds: extractAnimateIds(shiftTargets.elElementsToAnimate),
    elNewItemTransitionStyles: [],
    actuallyAddedVideos: []
  };
}

function teardownGridTransition(context: GridTransitionContext) {
  context.elShiftStyle.remove();
  context.elNewItemTransitionStyles[0]?.remove();
  clearItemViewTransitionNames(context.elElementsToAnimate);
  clearItemViewTransitionNames(context.elSectionsToAnimate);
  for (const video of context.actuallyAddedVideos) {
    const elNewItem = findItemElement(video.videoId);
    if (elNewItem) {
      elNewItem.style.viewTransitionName = "";
    }
  }
  clearAllItemViewTransitionNames();
}

async function fallbackAddBySection(videosToAdd: VideoSnapshot[], allFreshSnapshots: VideoSnapshot[]) {
  const processedSectionTitles = new Set<string>();
  for (const { sectionTitle } of videosToAdd) {
    if (processedSectionTitles.has(sectionTitle)) continue;
    processedSectionTitles.add(sectionTitle);
    await addSectionToDom(
      sectionTitle,
      allFreshSnapshots.filter(video => video.sectionTitle === sectionTitle)
    );
  }
}

function applyVideoInsertions(
  elGrid: PolymerElement,
  sortedVideos: VideoSnapshot[],
  freshOrderMap: Map<string, number>,
  allSnapshotMap: Map<string, VideoSnapshot>
) {
  const newContents = [...deepArray(elGrid.data, "contents")];
  const { newSectionGroups, videosForNormalPath } = planInsertions(newContents, sortedVideos);

  for (const [sectionTitle, sectionVideos] of newSectionGroups) {
    insertNewSection(newContents, sectionTitle, sectionVideos, freshOrderMap);
  }

  const actuallyAddedVideos: VideoSnapshot[] = [];
  for (const video of videosForNormalPath) {
    insertVideoOrStandalone(newContents, video, freshOrderMap, allSnapshotMap, actuallyAddedVideos);
  }

  elGrid.set("data.contents", newContents);
  return actuallyAddedVideos;
}

function planInsertions(newContents: unknown[], sortedVideos: VideoSnapshot[]) {
  const newSectionGroups = new Map<string, VideoSnapshot[]>();
  const videosForNormalPath: VideoSnapshot[] = [];
  for (const video of sortedVideos) {
    const needsNewSection = video.sectionTitle && findExistingSectionIndex(newContents, video.sectionTitle) < 0;
    if (needsNewSection) {
      const group = newSectionGroups.get(video.sectionTitle) ?? [];
      group.push(video);
      newSectionGroups.set(video.sectionTitle, group);
    } else {
      videosForNormalPath.push(video);
    }
  }
  return { newSectionGroups, videosForNormalPath };
}

function insertVideoOrStandalone(
  newContents: unknown[],
  video: VideoSnapshot,
  freshOrderMap: Map<string, number>,
  allSnapshotMap: Map<string, VideoSnapshot>,
  actuallyAddedVideos: VideoSnapshot[]
) {
  const iSection = findExistingSectionIndex(newContents, video.sectionTitle);
  let wasInserted = false;
  if (iSection >= 0) {
    wasInserted = tryInsertIntoExistingRichShelf(newContents, iSection, video) ||
      tryInsertIntoExistingInnerShelf(newContents, iSection, video);
  }

  if (wasInserted) return;
  if (newContents.some(item => videoIdFromRichItem(item) === video.videoId)) return;

  const freshIndex = freshOrderMap.get(video.videoId) ?? 0;
  const iInsert = findGridInsertIndex(newContents, freshIndex, freshOrderMap, video.status, allSnapshotMap);
  newContents.splice(iInsert, 0, buildRichItem(video.rawRenderer));
  actuallyAddedVideos.push(video);
}

function findExistingSectionIndex(contents: unknown[], sectionTitle: string) {
  if (!sectionTitle) return -1;
  return contents.findIndex(item =>
    deepString(item, "richSectionRenderer", "content", "richShelfRenderer", "title", "runs", "0", "text") === sectionTitle ||
    deepString(item, "richSectionRenderer", "content", "shelfRenderer", "title", "runs", "0", "text") === sectionTitle
  );
}

function insertNewSection(
  newContents: unknown[],
  sectionTitle: string,
  sectionVideos: VideoSnapshot[],
  freshOrderMap: Map<string, number>
) {
  const sectionMinimumFreshIndex = sectionVideos.reduce(
    (minimum, sectionVideo) => Math.min(minimum, freshOrderMap.get(sectionVideo.videoId) ?? Infinity),
    Infinity
  );
  const iInsert = findSectionInsertIndex(newContents, sectionMinimumFreshIndex, freshOrderMap);
  newContents.splice(iInsert, 0, buildNewRichSection(sectionTitle, sectionVideos));
}

function tryInsertIntoExistingRichShelf(newContents: unknown[], iSection: number, video: VideoSnapshot) {
  const section = deepRecord(newContents[iSection], "richSectionRenderer");
  const content = deepRecord(section, "content");
  const richShelf = deepRecord(content, "richShelfRenderer");
  if (!section || !content || !richShelf) return false;

  const shelfContents = deepArray(richShelf, "contents");
  if (!shelfContents.some(item => videoIdFromRichItem(item) === video.videoId)) {
    newContents[iSection] = {
      richSectionRenderer: {
        ...section,
        content: {
          ...content,
          richShelfRenderer: { ...richShelf, contents: [buildRichItem(video.rawRenderer), ...shelfContents] }
        }
      }
    };
  }
  return true;
}

function tryInsertIntoExistingInnerShelf(newContents: unknown[], iSection: number, video: VideoSnapshot) {
  const section = deepRecord(newContents[iSection], "richSectionRenderer");
  const content = deepRecord(section, "content");
  const innerShelf = deepRecord(content, "shelfRenderer");
  const innerContent = deepRecord(innerShelf, "content");
  if (!section || !content || !innerShelf || !innerContent || !isVideoRenderer(video.rawRenderer)) return false;

  const horizontalList = deepRecord(innerContent, "horizontalListRenderer");
  const gridList = deepRecord(innerContent, "gridRenderer");
  const listKey = !horizontalList && gridList ? "gridRenderer" : "horizontalListRenderer";
  const existingList: Record<string, unknown> = horizontalList ?? gridList ?? {};
  const items = deepArray(existingList, "items");
  const isAlreadyPresent = items.some(item => videoIdFromShelfListItem(item) === video.videoId);

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
              [listKey]: { ...existingList, items: [{ videoRenderer: video.rawRenderer }, ...items] }
            }
          }
        }
      }
    };
  }
  return true;
}

async function applyNewItemAnimations(
  elGridContents: HTMLElement,
  elElementsToAnimate: HTMLElement[],
  actuallyAddedVideos: VideoSnapshot[],
  animateIds: Set<string>
) {
  for (const elItem of elElementsToAnimate) {
    if (elItem.tagName === "YTD-RICH-ITEM-RENDERER") {
      elItem.style.viewTransitionName = "";
    }
  }

  await waitForFrames(() => actuallyAddedVideos.every(video => findItemElement(video.videoId)));

  reassignTransitionNames(
    elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer"),
    animateIds
  );

  const elNewItems: HTMLElement[] = [];
  for (const video of actuallyAddedVideos) {
    const elNewItem = findItemElement(video.videoId);
    if (elNewItem) {
      elNewItem.style.viewTransitionName = `ytsua-item-${video.videoId}`;
      elNewItems.push(elNewItem);
    }
  }
  return elNewItems;
}

function collectGridModelIds(elGrid: PolymerElement) {
  if (!isRecord(elGrid.data)) {
    return { standaloneModelIds: new Set<string>(), standaloneModelDuplicates: new Set<string>(), sectionIds: new Set<string>() };
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
      continue;
    }

    for (const shelfItem of deepArray(item, "richSectionRenderer", "content", "richShelfRenderer", "contents")) {
      const shelfId = videoIdFromRichItem(shelfItem);
      if (shelfId) sectionIds.add(shelfId);
    }
    for (const listItem of shelfRendererListItems(item)) {
      const videoId = videoIdFromShelfListItem(listItem);
      if (videoId) sectionIds.add(videoId);
    }
  }

  return { standaloneModelIds, standaloneModelDuplicates, sectionIds };
}

function filterMisplacedAndDuplicates(
  elGrid: PolymerElement,
  misplacedIds: Set<string>,
  standaloneModelDuplicates: Set<string>
) {
  if (!isRecord(elGrid.data)) return;
  const seenDuplicates = new Set<string>();
  const filteredContents = deepArray(elGrid.data, "contents").filter(item => {
    const videoId = videoIdFromRichItem(item);
    if (!videoId) return true;
    if (misplacedIds.has(videoId)) return false;
    if (standaloneModelDuplicates.has(videoId)) {
      if (seenDuplicates.has(videoId)) return false;
      seenDuplicates.add(videoId);
    }
    return true;
  });
  elGrid.set("data.contents", filteredContents);
}

function pruneOrphanedDomItems(elGridContents: HTMLElement, standaloneModelIds: Set<string>) {
  const seenDomIds = new Set<string>();
  for (const elChild of [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer, :scope > ytd-rich-section-renderer")]) {
    if (elChild.tagName !== "YTD-RICH-ITEM-RENDERER" || !isPolymerElement(elChild)) continue;

    const videoId = videoIdFromData(elChild.data);
    const isInModel = !!videoId && standaloneModelIds.has(videoId);
    const isDuplicate = !!videoId && seenDomIds.has(videoId);
    if (!isInModel || isDuplicate) {
      elChild.remove();
    } else if (videoId) {
      seenDomIds.add(videoId);
    }
  }
}

function shelfRendererListItems(contentItem: unknown) {
  return [
    ...deepArray(contentItem, "richSectionRenderer", "content", "shelfRenderer", "content", "horizontalListRenderer", "items"),
    ...deepArray(contentItem, "richSectionRenderer", "content", "shelfRenderer", "content", "gridRenderer", "items")
  ];
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
      iInsert = i;
      break;
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
