import {
  deepArray,
  deepRecord,
  isPolymerElement,
  isRecord,
  videoIdFromData
} from "../helpers";
import type { InnerTubeRichGridItem, VideoSnapshot } from "../types";
import {
  assignItemViewTransitionNames,
  buildShiftTransitionStyle,
  clearAllItemViewTransitionNames,
  extractAnimateIds,
  filterToViewport,
  reassignTransitionNames,
  triggerAnimation,
  waitForFrames,
  withViewTransitionLock
} from "./animations";
import { buildRichItem } from "./build";
import { findItemElement, findShelfForSection } from "./query";
import { filterOutRichItems, sortByFreshOrder, videoIdFromRichItem } from "./rich-item";
import { updateVideoInDom } from "./update";

export async function moveVideosToFront({ videos, allFreshSnapshots }: {
  videos: VideoSnapshot[];
  allFreshSnapshots: VideoSnapshot[];
}) {
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
    await moveVideosToShelfFront({
      elShelf,
      videos: shelfVideos,
      freshOrder
    });
  }

  if (gridVideos.length > 0) {
    await moveVideosToGridFront({
      videos: gridVideos,
      freshOrder
    });
  }
}

async function moveVideosToShelfFront({
  elShelf,
  videos,
  freshOrder
}: {
  elShelf: HTMLElement;
  videos: VideoSnapshot[];
  freshOrder: Map<string, number>;
}) {
  if (!isPolymerElement(elShelf) || !isRecord(elShelf.data)) {
    await fallbackUpdate(videos);
    return;
  }

  const sortedVideos = sortByFreshOrder({
    videos,
    freshOrder
  });
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

  const elShiftStyle = buildShiftTransitionStyle({ elItems: elShelfItems });
  document.head.append(elShiftStyle);

  await withViewTransitionLock(async () => {
    try {
      await document.startViewTransition(async () => {
        const freshShelfContents = deepArray<InnerTubeRichGridItem>(elShelf.data, "contents");
        const remainingContents = filterOutRichItems({
          contents: freshShelfContents,
          excludeVideoIds: movingVideoIds
        });
        const newItems = sortedVideos.map(({ rawRenderer }) => buildRichItem(rawRenderer));
        elShelf.set("data.contents", [...newItems, ...remainingContents]);
        for (const elItem of elShelfItems) {
          elItem.style.viewTransitionName = "";
        }
        await waitForFrames({ predicate: () => videoIdFromData(elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")[0]) === sortedVideos[0].videoId });
        reassignTransitionNames({
          elItems: elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer"),
          animateIds
        });
      }).finished;
    } finally {
      clearAllItemViewTransitionNames();
      elShiftStyle.remove();
      for (const { videoId } of sortedVideos) {
        const elMovedItem = findItemElement(videoId);
        if (elMovedItem) {
          triggerAnimation({
            elTarget: elMovedItem,
            animationClass: "ytsua-updated"
          });
        }
      }
    }
  });
}

async function moveVideosToGridFront({ videos, freshOrder }: {
  videos: VideoSnapshot[];
  freshOrder: Map<string, number>;
}) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    await fallbackUpdate(videos);
    return;
  }

  const sortedVideos = sortByFreshOrder({
    videos,
    freshOrder
  });
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

  const elShiftStyle = buildShiftTransitionStyle({ elItems: elAllItems });
  document.head.append(elShiftStyle);

  await withViewTransitionLock(async () => {
    try {
      await document.startViewTransition(async () => {
        const freshGridContents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents");
        const remainingContents = filterOutRichItems({
          contents: freshGridContents,
          excludeVideoIds: movingVideoIds
        });
        const iEffectiveInsert = remainingContents.findIndex(contentItem => !!deepRecord(contentItem, "richItemRenderer"));
        const iInsertAt = iEffectiveInsert >= 0 ? iEffectiveInsert : remainingContents.length;
        const newItems = sortedVideos.map(({ rawRenderer }) => buildRichItem(rawRenderer));
        const newGridContents = [...remainingContents];
        newGridContents.splice(iInsertAt, 0, ...newItems);
        elGrid.set("data.contents", newGridContents);
        for (const elItem of elAllItems) {
          elItem.style.viewTransitionName = "";
        }
        await waitForFrames({
          predicate() {
            const firstItemId = elGridContents
              ? videoIdFromData(elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")[0])
              : null;
            return firstItemId === sortedVideos[0].videoId;
          }
        });
        const elQueryItems = elGridContents
          ? elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")
          : document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer");
        reassignTransitionNames({
          elItems: elQueryItems,
          animateIds
        });
      }).finished;
    } finally {
      clearAllItemViewTransitionNames();
      elShiftStyle.remove();
      for (const { videoId } of sortedVideos) {
        const elMovedItem = findItemElement(videoId);
        if (elMovedItem) {
          triggerAnimation({
            elTarget: elMovedItem,
            animationClass: "ytsua-updated"
          });
        }
      }
    }
  });
}

function fallbackUpdate(videos: VideoSnapshot[]) {
  for (const video of videos) {
    updateVideoInDom({
      videoId: video.videoId,
      freshSnapshot: video
    });
  }
}
