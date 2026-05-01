import type { VideoSnapshot } from "../types";
import {
  assignItemViewTransitionNames, buildShiftTransitionStyle, clearAllItemViewTransitionNames, extractAnimateIds, filterToViewport, reassignTransitionNames, triggerAnimation
} from "./animations";
import {
  deepArray, deepRecord, isPolymerElement, isRecord, videoIdFromData 
} from "../helpers";
import { buildRichItem } from "./build";
import { findItemElement, findShelfForSection } from "./query";
import { filterOutRichItems, sortByFreshOrder, videoIdFromRichItem } from "./rich-item";
import { updateVideoInDom } from "./update";

export async function moveVideosToFront(videos: VideoSnapshot[], allFreshSnapshots: VideoSnapshot[]) {
  if (videos.length === 0) {
    return;
  }

  const freshOrder = new Map(allFreshSnapshots.map((video, i) => [video.videoId, i]));
  const shelfGroups = new Map<HTMLElement, VideoSnapshot[]>();
  const gridVideos: VideoSnapshot[] = [];

  for (const video of videos) {
    const elShelf = findShelfForSection(video.sectionTitle);
    if (elShelf) {
      const existing = shelfGroups.get(elShelf) ?? [];
      existing.push(video);
      shelfGroups.set(elShelf, existing);
    } else {
      gridVideos.push(video);
    }
  }

  for (const [elShelf, shelfVideos] of shelfGroups) {
    await moveVideosToShelfFront(elShelf, shelfVideos, freshOrder);
  }
  if (gridVideos.length > 0) {
    await moveVideosToGridFront(gridVideos, freshOrder);
  }
}

async function moveVideosToShelfFront(
  elShelf: HTMLElement,
  videos: VideoSnapshot[],
  freshOrder: Map<string, number>
) {
  if (!isPolymerElement(elShelf) || !isRecord(elShelf.data)) {
    await fallbackUpdate(videos);
    return;
  }

  const sortedVideos = sortByFreshOrder(videos, freshOrder);
  const movingVideoIds = new Set(sortedVideos.map(({ videoId }) => videoId));
  const shelfContents = deepArray(elShelf.data, "contents");
  const isAlreadyAtFront = sortedVideos.every(
    (video, i) => videoIdFromRichItem(shelfContents[i]) === video.videoId
  );

  if (isAlreadyAtFront) {
    await fallbackUpdate(sortedVideos);
    return;
  }

  clearAllItemViewTransitionNames();

  const elShelfItems = filterToViewport(elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer"));
  assignItemViewTransitionNames(elShelfItems);

  const animateIds = extractAnimateIds(elShelfItems);

  const elShiftStyle = buildShiftTransitionStyle(elShelfItems);
  document.head.append(elShiftStyle);

  try {
    await document.startViewTransition(async () => {
      const freshShelfContents = deepArray(elShelf.data, "contents");
      const remainingContents = filterOutRichItems(freshShelfContents, movingVideoIds);
      const newItems = sortedVideos.map(({ rawRenderer }) => buildRichItem(rawRenderer));
      elShelf.set("data.contents", [...newItems, ...remainingContents]);
      for (const elItem of elShelfItems) {
        elItem.style.viewTransitionName = "";
      }
      for (let i = 0; i < 10; i++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const firstItemId = videoIdFromData(elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")[0]);
        if (firstItemId === sortedVideos[0].videoId) {
          break;
        }
      }
      reassignTransitionNames(elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer"), animateIds);
    }).finished;
  } finally {
    clearAllItemViewTransitionNames();
    elShiftStyle.remove();
    for (const { videoId } of sortedVideos) {
      const elMovedItem = findItemElement(videoId);
      if (elMovedItem) {
        triggerAnimation(elMovedItem, "ytsua-updated");
      }
    }
  }
}

async function moveVideosToGridFront(videos: VideoSnapshot[], freshOrder: Map<string, number>) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    await fallbackUpdate(videos);
    return;
  }

  const sortedVideos = sortByFreshOrder(videos, freshOrder);
  const movingVideoIds = new Set(sortedVideos.map(({ videoId }) => videoId));
  const gridContents = deepArray(elGrid.data, "contents");
  const iTargetInsert = gridContents.findIndex(contentItem => !!deepRecord(contentItem, "richItemRenderer"));

  if (iTargetInsert < 0) {
    await fallbackUpdate(sortedVideos);
    return;
  }

  const isAlreadyAtFront = sortedVideos.every(
    (video, i) => videoIdFromRichItem(gridContents[iTargetInsert + i]) === video.videoId
  );

  if (isAlreadyAtFront) {
    await fallbackUpdate(sortedVideos);
    return;
  }

  clearAllItemViewTransitionNames();

  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  const elAllItems = filterToViewport(
    elGridContents
      ? [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")]
      : [...document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")]
  );

  const animateIds = extractAnimateIds(elAllItems);

  assignItemViewTransitionNames(elAllItems);

  const elShiftStyle = buildShiftTransitionStyle(elAllItems);
  document.head.append(elShiftStyle);

  try {
    await document.startViewTransition(async () => {
      const freshGridContents = deepArray(elGrid.data, "contents");
      const remainingContents = filterOutRichItems(freshGridContents, movingVideoIds);
      const iEffectiveInsert = remainingContents.findIndex(contentItem => !!deepRecord(contentItem, "richItemRenderer"));
      const iInsertAt = iEffectiveInsert >= 0 ? iEffectiveInsert : remainingContents.length;
      const newItems = sortedVideos.map(({ rawRenderer }) => buildRichItem(rawRenderer));
      const newGridContents = [...remainingContents];
      newGridContents.splice(iInsertAt, 0, ...newItems);
      elGrid.set("data.contents", newGridContents);
      for (const elItem of elAllItems) {
        elItem.style.viewTransitionName = "";
      }
      for (let i = 0; i < 10; i++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const firstItemId = elGridContents
          ? videoIdFromData(elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")[0])
          : null;
        if (firstItemId === sortedVideos[0].videoId) {
          break;
        }
      }
      const elQueryItems = elGridContents
        ? elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")
        : document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer");
      reassignTransitionNames(elQueryItems, animateIds);
    }).finished;
  } finally {
    clearAllItemViewTransitionNames();
    elShiftStyle.remove();
    for (const { videoId } of sortedVideos) {
      const elMovedItem = findItemElement(videoId);
      if (elMovedItem) {
        triggerAnimation(elMovedItem, "ytsua-updated");
      }
    }
  }
}

function fallbackUpdate(videos: VideoSnapshot[]) {
  for (const video of videos) {
    updateVideoInDom(video.videoId, video);
  }
}
