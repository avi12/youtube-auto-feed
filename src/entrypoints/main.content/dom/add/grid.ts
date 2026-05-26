import { isRichShelfRenderer, isShelfRenderer, isVideoRenderer } from "../../api/guards";
import {
  deepArray,
  deepRecord,
  isPolymerElement,
  isRecord,
  videoIdFromData,
  videoIdFromShelfListItem
} from "../../helpers";
import { type InnerTubeRichGridItem, type PolymerElement, type VideoSnapshot, VideoStatus } from "../../types";
import {
  assignItemViewTransitionNames,
  buildNewItemTransitionStyle,
  buildShiftTransitionStyle,
  calculateStaggerDelayMs,
  clearAllItemViewTransitionNames,
  clearItemViewTransitionNames,
  extractAnimateIds,
  isInViewport,
  prefersReducedMotion,
  reassignTransitionNames,
  waitForFrames,
  withViewTransitionLock
} from "../animations";
import { buildRichItem, preloadThumbnails } from "../build";
import { scheduleLazyEntrance } from "../lazy-update";
import { findItemElement } from "../query";
import { sortByFreshOrder, videoIdFromRichItem } from "../rich-item";
import { addSectionToDom } from "./section";

export async function addVideosToGridDom({ videosToAdd, allFreshSnapshots }: {
  videosToAdd: VideoSnapshot[];
  allFreshSnapshots: VideoSnapshot[];
}) {
  await preloadThumbnails(videosToAdd);
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid)) {
    await fallbackAddBySection({
      videosToAdd,
      allFreshSnapshots
    });
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
  const sortedVideos = sortByFreshOrder({
    videos: videosToAdd,
    freshOrder: freshOrderMap
  });
  const standaloneVideos = sortedVideos.filter(video => !video.sectionTitle);
  if (prefersReducedMotion()) {
    applyVideoInsertions({
      elGrid,
      sortedVideos,
      freshOrderMap,
      allSnapshotMap
    });
  } else {
    const transitionContext = setupGridTransition({
      elGridContents,
      standaloneVideos,
      freshOrderMap
    });

    await withViewTransitionLock(async () => {
      try {
        await document.startViewTransition(async () => {
          const actuallyAddedVideos = applyVideoInsertions({
            elGrid,
            sortedVideos,
            freshOrderMap,
            allSnapshotMap
          });
          transitionContext.actuallyAddedVideos = actuallyAddedVideos;

          const elNewItems = await applyNewItemAnimations({
            elGridContents,
            elElementsToAnimate: transitionContext.elElementsToAnimate,
            actuallyAddedVideos,
            animateIds: transitionContext.animateIds
          });
          if (elNewItems.length > 0) {
            const elStyle = buildNewItemTransitionStyle(elNewItems);
            document.head.append(elStyle);
            transitionContext.elNewItemTransitionStyles.push(elStyle);
          }
        }).finished;
      } finally {
        teardownGridTransition(transitionContext);
      }
    });

    const lazyEntranceItems: HTMLElement[] = [...transitionContext.aboveViewportShiftItems];
    for (const video of transitionContext.actuallyAddedVideos) {
      const elItem = findItemElement(video.videoId);
      if (elItem && !isInViewport(elItem)) {
        lazyEntranceItems.push(elItem);
      }
    }
    scheduleLazyEntrance(lazyEntranceItems);
  }

  for (const elSection of document.querySelectorAll<HTMLElement>("ytd-rich-section-renderer.ytsua-section-removing")) {
    elSection.classList.remove("ytsua-section-removing");
  }
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

  const { standaloneModelIds, standaloneModelDuplicates } = collectGridModelIds(elGrid);
  if (standaloneModelDuplicates.size > 0) {
    filterMisplacedAndDuplicates({
      elGrid,
      misplacedIds: new Set(),
      standaloneModelDuplicates
    });
  }

  pruneOrphanedDomItems({
    elGridContents,
    standaloneModelIds
  });
  pruneOrphanedDomSections({
    elGrid,
    elGridContents
  });
}

function pruneOrphanedDomSections({ elGrid, elGridContents }: {
  elGrid: PolymerElement;
  elGridContents: HTMLElement;
}) {
  if (!isRecord(elGrid.data)) {
    return;
  }

  const titleCounts = new Map<string, number>();
  for (const item of deepArray<InnerTubeRichGridItem>(elGrid.data, "contents")) {
    const richShelfTitle = item?.richSectionRenderer?.content?.richShelfRenderer?.title?.runs?.[0]?.text ?? "";
    const innerShelfTitle = item?.richSectionRenderer?.content?.shelfRenderer?.title?.runs?.[0]?.text ?? "";
    const title = richShelfTitle || innerShelfTitle;
    if (title) {
      titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    }
  }

  for (const elSection of [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-section-renderer")]) {
    const title = elSection.querySelector("#title")?.textContent?.trim() ?? "";
    const remaining = titleCounts.get(title) ?? 0;
    if (remaining > 0) {
      titleCounts.set(title, remaining - 1);
      continue;
    }

    elSection.remove();
  }
}

interface GridTransitionContext {
  elShiftStyle: HTMLStyleElement;
  elElementsToAnimate: HTMLElement[];
  elSectionsToAnimate: HTMLElement[];
  animateIds: Set<string>;
  elNewItemTransitionStyles: HTMLStyleElement[];
  actuallyAddedVideos: VideoSnapshot[];
  aboveViewportShiftItems: HTMLElement[];
}

function setupGridTransition({
  elGridContents,
  standaloneVideos,
  freshOrderMap
}: {
  elGridContents: HTMLElement;
  standaloneVideos: VideoSnapshot[];
  freshOrderMap: Map<string, number>;
}): GridTransitionContext {
  clearAllItemViewTransitionNames();

  const elAllItems = [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")];
  const shiftTargets = standaloneVideos.length > 0
    ? collectGridShiftTargets({
      elGridContents,
      elAllItems,
      sortedVideos: standaloneVideos,
      freshOrderMap
    })
    : {
      elElementsToAnimate: [],
      elSectionsToAnimate: [],
      aboveViewportShiftItems: []
    };

  assignItemViewTransitionNames(shiftTargets.elElementsToAnimate);
  const elShiftStyle = buildShiftTransitionStyle({
    elItems: shiftTargets.elElementsToAnimate,
    excludeNames: new Set(),
    delayPerItemMs: calculateStaggerDelayMs(shiftTargets.elElementsToAnimate.length)
  });
  document.head.append(elShiftStyle);

  return {
    elShiftStyle,
    elElementsToAnimate: shiftTargets.elElementsToAnimate,
    elSectionsToAnimate: shiftTargets.elSectionsToAnimate,
    animateIds: extractAnimateIds(shiftTargets.elElementsToAnimate),
    elNewItemTransitionStyles: [],
    actuallyAddedVideos: [],
    aboveViewportShiftItems: shiftTargets.aboveViewportShiftItems
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

async function fallbackAddBySection({ videosToAdd, allFreshSnapshots }: {
  videosToAdd: VideoSnapshot[];
  allFreshSnapshots: VideoSnapshot[];
}) {
  const processedSectionTitles = new Set<string>();
  for (const { sectionTitle } of videosToAdd) {
    if (processedSectionTitles.has(sectionTitle)) {
      continue;
    }

    processedSectionTitles.add(sectionTitle);
    await addSectionToDom({
      sectionTitle,
      videos: allFreshSnapshots.filter(video => video.sectionTitle === sectionTitle),
      allFreshSnapshots
    });
  }
}

function applyVideoInsertions({
  elGrid,
  sortedVideos,
  freshOrderMap,
  allSnapshotMap
}: {
  elGrid: PolymerElement;
  sortedVideos: VideoSnapshot[];
  freshOrderMap: Map<string, number>;
  allSnapshotMap: Map<string, VideoSnapshot>;
}) {
  const newContents = [...deepArray<InnerTubeRichGridItem>(elGrid.data, "contents")];
  const { newSectionGroups, videosForNormalPath } = planInsertions({
    newContents,
    sortedVideos
  });

  for (const [sectionTitle, sectionVideos] of newSectionGroups) {
    insertNewSection({
      newContents,
      sectionTitle,
      sectionVideos,
      freshOrderMap
    });
  }

  const actuallyAddedVideos: VideoSnapshot[] = [];
  for (const video of videosForNormalPath) {
    insertVideoOrStandalone({
      newContents,
      video,
      freshOrderMap,
      allSnapshotMap,
      actuallyAddedVideos
    });
  }

  elGrid.set("data.contents", newContents);
  return actuallyAddedVideos;
}

function planInsertions({ newContents, sortedVideos }: {
  newContents: InnerTubeRichGridItem[];
  sortedVideos: VideoSnapshot[];
}) {
  const newSectionGroups = new Map<string, VideoSnapshot[]>();
  const videosForNormalPath: VideoSnapshot[] = [];
  for (const video of sortedVideos) {
    const needsNewSection = video.sectionTitle && findExistingSectionIndex({
      contents: newContents,
      sectionTitle: video.sectionTitle
    }) < 0;
    if (needsNewSection) {
      const group = newSectionGroups.get(video.sectionTitle) ?? [];
      group.push(video);
      newSectionGroups.set(video.sectionTitle, group);
    } else {
      videosForNormalPath.push(video);
    }
  }
  return {
    newSectionGroups,
    videosForNormalPath
  };
}

function insertVideoOrStandalone({
  newContents,
  video,
  freshOrderMap,
  allSnapshotMap,
  actuallyAddedVideos
}: {
  newContents: InnerTubeRichGridItem[];
  video: VideoSnapshot;
  freshOrderMap: Map<string, number>;
  allSnapshotMap: Map<string, VideoSnapshot>;
  actuallyAddedVideos: VideoSnapshot[];
}) {
  const iSection = findExistingSectionIndex({
    contents: newContents,
    sectionTitle: video.sectionTitle
  });
  let wasInserted = false;
  if (iSection >= 0) {
    wasInserted = tryInsertIntoExistingRichShelf({
      newContents,
      iSection,
      video
    }) ||
      tryInsertIntoExistingInnerShelf({
        newContents,
        iSection,
        video
      });
  }

  if (wasInserted) {
    return;
  }

  if (newContents.some(item => videoIdFromRichItem(item) === video.videoId)) {
    return;
  }

  const freshIndex = freshOrderMap.get(video.videoId) ?? 0;
  const iInsert = !video.sectionTitle
    ? findZoneInsertIndex({
      contents: newContents,
      bandIndex: video.bandIndex,
      freshIndex,
      freshOrderMap,
      videoStatus: video.status,
      allSnapshotMap
    })
    : findGridInsertIndex({
      contents: newContents,
      freshIndex,
      freshOrderMap,
      videoStatus: video.status,
      allSnapshotMap
    });
  newContents.splice(iInsert, 0, buildRichItem(video.rawRenderer));
  actuallyAddedVideos.push(video);
}

function findExistingSectionIndex({ contents, sectionTitle }: {
  contents: InnerTubeRichGridItem[];
  sectionTitle: string;
}) {
  if (!sectionTitle) {
    return -1;
  }

  return contents.findIndex(item =>
    (item?.richSectionRenderer?.content?.richShelfRenderer?.title?.runs?.[0]?.text ?? "") === sectionTitle ||
    (item?.richSectionRenderer?.content?.shelfRenderer?.title?.runs?.[0]?.text ?? "") === sectionTitle);
}

function insertNewSection({
  newContents,
  sectionTitle,
  sectionVideos,
  freshOrderMap
}: {
  newContents: InnerTubeRichGridItem[];
  sectionTitle: string;
  sectionVideos: VideoSnapshot[];
  freshOrderMap: Map<string, number>;
}) {
  const sectionMinimumFreshIndex = sectionVideos.reduce(
    (minimum, sectionVideo) => Math.min(minimum, freshOrderMap.get(sectionVideo.videoId) ?? Infinity),
    Infinity
  );
  const iInsert = findSectionInsertIndex({
    contents: newContents,
    sectionMinimumFreshIndex,
    freshOrderMap
  });
  newContents.splice(
    iInsert, 0, buildNewRichSection({
      sectionTitle,
      videos: sectionVideos
    })
  );
}

function tryInsertIntoExistingRichShelf({ newContents, iSection, video }: {
  newContents: InnerTubeRichGridItem[];
  iSection: number;
  video: VideoSnapshot;
}) {
  const section = deepRecord(newContents[iSection], "richSectionRenderer");
  const content = deepRecord(section, "content");
  const richShelfRaw = deepRecord(content, "richShelfRenderer");
  if (!section || !content || !richShelfRaw || !isRichShelfRenderer(richShelfRaw)) {
    return false;
  }

  const shelfContents = richShelfRaw.contents;
  if (!shelfContents.some(item => videoIdFromRichItem(item) === video.videoId)) {
    newContents[iSection] = {
      richSectionRenderer: {
        ...section,
        content: {
          ...content,
          richShelfRenderer: {
            ...richShelfRaw,
            contents: [buildRichItem(video.rawRenderer), ...shelfContents]
          }
        }
      }
    };
  }

  return true;
}

function tryInsertIntoExistingInnerShelf({ newContents, iSection, video }: {
  newContents: InnerTubeRichGridItem[];
  iSection: number;
  video: VideoSnapshot;
}) {
  const section = deepRecord(newContents[iSection], "richSectionRenderer");
  const content = deepRecord(section, "content");
  const innerShelfRaw = deepRecord(content, "shelfRenderer");
  if (!section || !content || !innerShelfRaw || !isShelfRenderer(innerShelfRaw)) {
    return false;
  }

  if (!isVideoRenderer(video.rawRenderer)) {
    return false;
  }

  const innerShelf = innerShelfRaw;
  const innerContent = innerShelf.content;

  const horizontalList = deepRecord(innerContent, "horizontalListRenderer");
  const gridList = deepRecord(innerContent, "gridRenderer");
  // Inner shelves emit either horizontalListRenderer or gridRenderer; preserve whichever YouTube used.
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
              [listKey]: {
                ...existingList,
                items: [{ videoRenderer: video.rawRenderer }, ...items]
              }
            }
          }
        }
      }
    };
  }

  return true;
}

async function applyNewItemAnimations({
  elGridContents,
  elElementsToAnimate,
  actuallyAddedVideos,
  animateIds
}: {
  elGridContents: HTMLElement;
  elElementsToAnimate: HTMLElement[];
  actuallyAddedVideos: VideoSnapshot[];
  animateIds: Set<string>;
}) {
  for (const elItem of elElementsToAnimate) {
    if (elItem.tagName === "YTD-RICH-ITEM-RENDERER") {
      elItem.style.viewTransitionName = "";
    }
  }

  await waitForFrames({ predicate: () => actuallyAddedVideos.every(video => findItemElement(video.videoId)) });

  reassignTransitionNames({
    elItems: elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer"),
    animateIds
  });

  const elNewItems: HTMLElement[] = [];
  for (const video of actuallyAddedVideos) {
    const elNewItem = findItemElement(video.videoId);
    if (elNewItem && isInViewport(elNewItem)) {
      elNewItem.style.viewTransitionName = `ytsua-item-${video.videoId}`;
      elNewItems.push(elNewItem);
    }
  }
  return elNewItems;
}

function collectGridModelIds(elGrid: PolymerElement) {
  if (!isRecord(elGrid.data)) {
    return {
      standaloneModelIds: new Set<string>(),
      standaloneModelDuplicates: new Set<string>(),
      sectionIds: new Set<string>()
    };
  }

  const standaloneModelIds = new Set<string>();
  const standaloneModelDuplicates = new Set<string>();

  for (const item of deepArray<InnerTubeRichGridItem>(elGrid.data, "contents")) {
    const topId = videoIdFromRichItem(item);
    if (!topId) {
      continue;
    }

    if (standaloneModelIds.has(topId)) {
      standaloneModelDuplicates.add(topId);
    } else {
      standaloneModelIds.add(topId);
    }
  }

  return {
    standaloneModelIds,
    standaloneModelDuplicates
  };
}

function filterMisplacedAndDuplicates({
  elGrid,
  misplacedIds,
  standaloneModelDuplicates
}: {
  elGrid: PolymerElement;
  misplacedIds: Set<string>;
  standaloneModelDuplicates: Set<string>;
}) {
  if (!isRecord(elGrid.data)) {
    return;
  }

  const seenDuplicates = new Set<string>();
  const filteredContents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents").filter(item => {
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
}

function pruneOrphanedDomItems({ elGridContents, standaloneModelIds }: {
  elGridContents: HTMLElement;
  standaloneModelIds: Set<string>;
}) {
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
    } else if (videoId) {
      seenDomIds.add(videoId);
    }
  }
}

export function findSectionInsertIndex({ contents, sectionMinimumFreshIndex, freshOrderMap }: {
  contents: InnerTubeRichGridItem[];
  sectionMinimumFreshIndex: number;
  freshOrderMap: Map<string, number>;
}) {
  let iInsert = 0;
  for (let i = 0; i < contents.length; i++) {
    const item = contents[i];
    const standaloneId = videoIdFromRichItem(item);
    if (standaloneId) {
      const standaloneFreshIndex = freshOrderMap.get(standaloneId);
      if (standaloneFreshIndex === undefined) {
        continue;
      }

      if (standaloneFreshIndex > sectionMinimumFreshIndex) {
        return i;
      }

      iInsert = i + 1;
      continue;
    }

    if (!isRecord(item) || !("richSectionRenderer" in item)) {
      continue;
    }

    const existingSectionItems = deepArray(item, "richSectionRenderer", "content", "richShelfRenderer", "contents");
    const knownIndices = existingSectionItems
      .map(contentItem => {
        const videoId = videoIdFromRichItem(contentItem);
        return videoId !== null ? freshOrderMap.get(videoId) : undefined;
      })
      .filter((index): index is number => index !== undefined);
    const isExistingSectionNewer = knownIndices.length > 0 && Math.min(...knownIndices) > sectionMinimumFreshIndex;
    if (isExistingSectionNewer) {
      return i;
    }

    iInsert = i + 1;
  }
  return iInsert;
}

function buildNewRichSection({ sectionTitle, videos }: {
  sectionTitle: string;
  videos: VideoSnapshot[];
}) {
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

function findZoneBoundaries(contents: InnerTubeRichGridItem[]) {
  const continuationIndex = contents.findIndex(item => isRecord(item) && "continuationItemRenderer" in item);
  const end = continuationIndex >= 0 ? continuationIndex : contents.length;
  const sectionBoundaries: number[] = [];
  for (let i = 0; i < end; i++) {
    const richShelfItems = deepArray(contents[i], "richSectionRenderer", "content", "richShelfRenderer", "contents");
    const shelfItems = [
      ...deepArray(contents[i], "richSectionRenderer", "content", "shelfRenderer", "content", "horizontalListRenderer", "items"),
      ...deepArray(contents[i], "richSectionRenderer", "content", "shelfRenderer", "content", "gridRenderer", "items")
    ];
    if (richShelfItems.length > 0 || shelfItems.length > 0) {
      sectionBoundaries.push(i);
    }
  }
  return {
    sectionBoundaries,
    end
  };
}

function findZoneInsertIndex({
  contents,
  bandIndex,
  freshIndex,
  freshOrderMap,
  videoStatus,
  allSnapshotMap
}: {
  contents: InnerTubeRichGridItem[];
  bandIndex: number;
  freshIndex: number;
  freshOrderMap: Map<string, number>;
  videoStatus: VideoStatus;
  allSnapshotMap: Map<string, VideoSnapshot>;
}) {
  const { sectionBoundaries, end } = findZoneBoundaries(contents);
  const zoneStart = bandIndex === 0 ? 0 : (sectionBoundaries[bandIndex - 1] ?? end - 1) + 1;
  const zoneEnd = sectionBoundaries[bandIndex] ?? end;
  const slice = contents.slice(zoneStart, zoneEnd);
  return findGridInsertIndex({
    contents: slice,
    freshIndex,
    freshOrderMap,
    videoStatus,
    allSnapshotMap
  }) + zoneStart;
}

function findGridInsertIndex({
  contents,
  freshIndex,
  freshOrderMap,
  videoStatus,
  allSnapshotMap
}: {
  contents: InnerTubeRichGridItem[];
  freshIndex: number;
  freshOrderMap: Map<string, number>;
  videoStatus: VideoStatus;
  allSnapshotMap: Map<string, VideoSnapshot>;
}) {
  let iInsert = 0;
  for (let i = 0; i < contents.length; i++) {
    const item = contents[i];
    if (isRecord(item) && "continuationItemRenderer" in item) {
      break;
    }

    const existingId = videoIdFromRichItem(item);
    if (existingId) {
      const existingFreshIndex = freshOrderMap.get(existingId);
      if (existingFreshIndex === undefined) {
        continue;
      }

      if (existingFreshIndex > freshIndex) {
        iInsert = i;
        break;
      }

      iInsert = i + 1;
      continue;
    }

    if (!isRecord(item) || !("richSectionRenderer" in item)) {
      continue;
    }

    const sectionItems = deepArray(item, "richSectionRenderer", "content", "richShelfRenderer", "contents");
    const knownIndices = sectionItems
      .map(contentItem => {
        const videoId = videoIdFromRichItem(contentItem);
        return videoId !== null ? freshOrderMap.get(videoId) : undefined;
      })
      .filter((index): index is number => index !== undefined);
    const isSectionNewer = knownIndices.length > 0 && Math.min(...knownIndices) > freshIndex;
    if (isSectionNewer) {
      iInsert = i;
      break;
    }

    iInsert = i + 1;
  }

  if (videoStatus === VideoStatus.Live) {
    return iInsert;
  }

  // Non-live items must land after every leading live item to keep live videos at the band head.
  let leadingLiveCount = 0;
  for (const item of contents) {
    const itemVideoId = videoIdFromRichItem(item);
    if (!itemVideoId) {
      break;
    }

    if (allSnapshotMap.get(itemVideoId)?.status !== VideoStatus.Live) {
      break;
    }

    leadingLiveCount++;
  }

  return Math.max(iInsert, leadingLiveCount);
}

function collectGridShiftTargets({
  elGridContents,
  elAllItems,
  sortedVideos,
  freshOrderMap
}: {
  elGridContents: HTMLElement;
  elAllItems: HTMLElement[];
  sortedVideos: VideoSnapshot[];
  freshOrderMap: Map<string, number>;
}) {
  const minFreshIndex = freshOrderMap.get(sortedVideos[0]?.videoId ?? "") ?? 0;
  // First DOM item whose fresh-order position is at or below an incoming video's; items from here downward shift.
  let firstShiftingItem: HTMLElement | undefined;
  for (const elItem of elAllItems) {
    const existingId = isPolymerElement(elItem) ? videoIdFromData(elItem.data) : null;
    const existingFreshIndex = freshOrderMap.get(existingId ?? "") ?? Infinity;
    if (existingFreshIndex >= minFreshIndex) {
      firstShiftingItem = elItem;
      break;
    }
  }

  const elElementsToAnimate: HTMLElement[] = [];
  const elSectionsToAnimate: HTMLElement[] = [];
  const aboveViewportShiftItems: HTMLElement[] = [];
  if (!firstShiftingItem) {
    return {
      elElementsToAnimate,
      elSectionsToAnimate,
      aboveViewportShiftItems
    };
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

    const top = elChild.getBoundingClientRect().top;
    if (top > innerHeight) {
      break;
    }

    if (top < 0) {
      aboveViewportShiftItems.push(elChild);
      continue;
    }

    elElementsToAnimate.push(elChild);

    if (elChild.tagName === "YTD-RICH-SECTION-RENDERER") {
      elChild.style.viewTransitionName = `ytsua-section-${iChild}`;
      elSectionsToAnimate.push(elChild);
    }
  }

  return {
    elElementsToAnimate,
    elSectionsToAnimate,
    aboveViewportShiftItems
  };
}
