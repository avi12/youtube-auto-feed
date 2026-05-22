import { deepArray, isPolymerElement, isRecord, videoIdFromData } from "../../helpers";
import { type PolymerElement, type VideoSnapshot, VideoStatus } from "../../types";
import {
  assignItemViewTransitionNames,
  buildNewItemTransitionStyle,
  buildShiftTransitionStyle,
  clearAllItemViewTransitionNames,
  clearItemViewTransitionNames,
  extractAnimateIds,
  filterToViewport,
  prefersReducedMotion,
  reassignTransitionNames,
  waitForFrames
} from "../animations";
import { buildRichItem, preloadThumbnails } from "../build";
import { findItemElement, findShelfForSection, leadingLiveCount } from "../query";
import { videoIdFromRichItem } from "../rich-item";
import { addSectionToDom } from "./section";

interface InsertOperation {
  video: VideoSnapshot;
  iInsert: number;
}

export async function addVideosToDom({
  freshSnapshots,
  allFreshSnapshots,
  snapshot
}: {
  freshSnapshots: VideoSnapshot[];
  allFreshSnapshots: VideoSnapshot[];
  snapshot: Map<string, VideoSnapshot>;
}) {
  await preloadThumbnails(freshSnapshots);
  const bySection = new Map<string, VideoSnapshot[]>();
  for (const video of freshSnapshots) {
    const sectionGroup = bySection.get(video.sectionTitle) ?? [];
    sectionGroup.push(video);
    bySection.set(video.sectionTitle, sectionGroup);
  }

  for (const [, sectionVideos] of bySection) {
    await addVideosToSection({
      videos: sectionVideos,
      allFreshSnapshots,
      snapshot
    });
  }
}

async function addVideosToSection({
  videos,
  allFreshSnapshots,
  snapshot
}: {
  videos: VideoSnapshot[];
  allFreshSnapshots: VideoSnapshot[];
  snapshot: Map<string, VideoSnapshot>;
}) {
  const { sectionTitle } = videos[0];
  const sectionVideos = allFreshSnapshots.filter(video => video.sectionTitle === sectionTitle);
  const elShelf = findShelfForSection(sectionTitle);
  if (!elShelf || !isPolymerElement(elShelf)) {
    await addSectionToDom({
      sectionTitle,
      videos: sectionVideos,
      allFreshSnapshots
    });
    return;
  }

  const shelfContents = deepArray(elShelf.data, "contents");
  const videosToInsert = videos.filter(
    video => !shelfContents.some(item => videoIdFromRichItem(item) === video.videoId)
  );
  if (videosToInsert.length === 0) {
    return;
  }

  const insertOperations = buildInsertOperations({
    videosToInsert,
    sectionVideos,
    elShelf,
    snapshot
  });
  const newShelfContents = [...shelfContents];
  for (const { video, iInsert } of insertOperations) {
    newShelfContents.splice(iInsert, 0, buildRichItem(video.rawRenderer));
  }

  const elAllShelfItems = [...elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")];
  const elExistingItems = filterToViewport(elAllShelfItems);
  const visibleCap = computeVisibleCap({
    elShelf,
    elExistingItems: elAllShelfItems
  });
  const displayCap = visibleCap ?? elAllShelfItems.length;
  const isCollapsed = isShelfCollapsed(elShelf);

  const anyVisibleInsert = isCollapsed || insertOperations.some(({ iInsert }) => iInsert < displayCap);
  if (!anyVisibleInsert || prefersReducedMotion()) {
    elShelf.set("data.contents", newShelfContents);
    return;
  }

  await runShelfInsertTransition({
    elShelf,
    elExistingItems,
    insertOperations,
    newShelfContents,
    displayCap,
    isCollapsed
  });
}

function buildInsertOperations({
  videosToInsert,
  sectionVideos,
  elShelf,
  snapshot
}: {
  videosToInsert: VideoSnapshot[];
  sectionVideos: VideoSnapshot[];
  elShelf: PolymerElement;
  snapshot: Map<string, VideoSnapshot>;
}) {
  return videosToInsert
    .map(video => {
      const iApiInsert = Math.max(0, sectionVideos.findIndex(sectionVideo => sectionVideo.videoId === video.videoId));
      const iInsert = video.status !== VideoStatus.Live
        ? Math.max(
          iApiInsert, leadingLiveCount({
            elShelf,
            snapshot
          })
        )
        : iApiInsert;
      return {
        video,
        iInsert
      };
    })
    .sort((opA, opB) => opB.iInsert - opA.iInsert);
}

function computeVisibleCap({ elShelf, elExistingItems }: {
  elShelf: PolymerElement;
  elExistingItems: HTMLElement[];
}) {
  if (isShelfCollapsed(elShelf)) {
    return null;
  }

  return computeVisibleItemCap(elExistingItems);
}

function isShelfCollapsed(elShelf: PolymerElement) {
  return isRecord(elShelf.data) && elShelf.data.isExpanded === false;
}

async function runShelfInsertTransition({
  elShelf,
  elExistingItems,
  insertOperations,
  newShelfContents,
  displayCap,
  isCollapsed
}: {
  elShelf: PolymerElement;
  elExistingItems: HTMLElement[];
  insertOperations: InsertOperation[];
  newShelfContents: unknown[];
  displayCap: number;
  isCollapsed: boolean;
}) {
  clearAllItemViewTransitionNames();
  assignItemViewTransitionNames(elExistingItems);
  const animateIds = extractAnimateIds(elExistingItems);

  const displayContents = isCollapsed ? newShelfContents : newShelfContents.slice(0, displayCap);
  const visibleVideosToInsert = insertOperations
    .map(({ video }) => video)
    .filter(video => displayContents.some(item => videoIdFromRichItem(item) === video.videoId));

  const iMinimumInsert = insertOperations[insertOperations.length - 1].iInsert;
  const overflowResult = isCollapsed ? buildCollapsedOverflowStyle({
    elExistingItems,
    iInsert: iMinimumInsert
  }) : null;
  if (overflowResult) {
    document.head.append(overflowResult.elStyle);
  }

  const excludeNames = overflowResult ? new Set([overflowResult.overflowName]) : new Set<string>();
  const elShiftStyle = buildShiftTransitionStyle({
    elItems: elExistingItems,
    excludeNames
  });
  document.head.append(elShiftStyle);

  const wasExpanded = isRecord(elShelf.data) ? elShelf.data.isExpanded : undefined;
  const elNewItemTransitionStyles: HTMLStyleElement[] = [];

  const transition = document.startViewTransition(async () => {
    elShelf.set("data.contents", displayContents);

    if (wasExpanded === false) {
      elShelf.set("data.isExpanded", false);
    }

    clearItemViewTransitionNames(elExistingItems);
    await waitForVideosToRender(visibleVideosToInsert);
    reassignTransitionNames({
      elItems: elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer"),
      animateIds
    });

    const elNewItems = collectNewItemElements(insertOperations);
    if (elNewItems.length > 0) {
      const elNewItemTransitionStyle = buildNewItemTransitionStyle(elNewItems);
      document.head.append(elNewItemTransitionStyle);
      elNewItemTransitionStyles.push(elNewItemTransitionStyle);
    }
  });

  try {
    await transition.finished;
  } finally {
    clearItemViewTransitionNames(elExistingItems);
    clearAllItemViewTransitionNames();
    overflowResult?.elStyle.remove();
    elShiftStyle.remove();
    elNewItemTransitionStyles[0]?.remove();
    for (const { video } of insertOperations) {
      const elNewItem = findItemElement(video.videoId);
      if (elNewItem) {
        elNewItem.style.viewTransitionName = "";
      }
    }
  }
}

async function waitForVideosToRender(videos: VideoSnapshot[]) {
  await waitForFrames({ predicate: () => videos.every(video => findItemElement(video.videoId)) });
}

function collectNewItemElements(insertOperations: InsertOperation[]) {
  const insertedAscending = insertOperations.toReversed();
  const elNewItems: HTMLElement[] = [];
  for (const { video } of insertedAscending) {
    const elNewItem = findItemElement(video.videoId);
    if (elNewItem) {
      elNewItem.style.viewTransitionName = `ytsua-item-${video.videoId}`;
      elNewItems.push(elNewItem);
    }
  }
  return elNewItems;
}

function computeVisibleItemCap(elExistingItems: HTMLElement[]) {
  const items = [...elExistingItems];
  if (items.length === 0) {
    return null;
  }

  const firstRowTop = items[0].getBoundingClientRect().top;
  const itemsInFirstRow = items.filter(
    elItem => Math.abs(elItem.getBoundingClientRect().top - firstRowTop) < 1
  ).length;
  if (itemsInFirstRow === 0) {
    return null;
  }

  const rowCount = new Set(items.map(elItem => Math.round(elItem.getBoundingClientRect().top))).size;
  return rowCount * itemsInFirstRow;
}

function buildCollapsedOverflowStyle({ elExistingItems, iInsert }: {
  elExistingItems: HTMLElement[];
  iInsert: number;
}) {
  const visibleItems = [...elExistingItems].filter(elItem => elItem.offsetWidth > 0);
  const elLastVisible = visibleItems.at(-1);
  if (!elLastVisible || iInsert >= visibleItems.length) {
    return null;
  }

  const overflowVideoId = isPolymerElement(elLastVisible) ? videoIdFromData(elLastVisible.data) : null;
  if (!overflowVideoId) {
    return null;
  }

  const elFirstVisible = visibleItems[0];
  const lastRect = elLastVisible.getBoundingClientRect();
  const firstRect = elFirstVisible?.getBoundingClientRect();
  const secondRect = visibleItems[1]?.getBoundingClientRect();
  const translateX = firstRect ? Math.round(firstRect.left - lastRect.left) : -Math.round(lastRect.width);
  const columnGap = secondRect && firstRect ? Math.max(0, Math.round(secondRect.left - firstRect.right)) : 0;
  const translateY = Math.round(lastRect.height + columnGap);
  const overflowName = `ytsua-item-${overflowVideoId}`;
  const elStyle = document.createElement("style");
  elStyle.textContent =
    `::view-transition-old(${overflowName}){animation:ytsua-shelf-overflow-exit 380ms cubic-bezier(0.4,0,0.2,1) forwards;--ytsua-overflow-translate:${translateX}px ${translateY}px}` +
    `::view-transition-new(${overflowName}){animation:none;opacity:0}`;
  return {
    elStyle,
    overflowName
  };
}
