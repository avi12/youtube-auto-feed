import { parseSecondsAgo } from "../api/guards";
import { deepArray, deepRecord, isPolymerElement, isRecord } from "../helpers";
import { type InnerTubeRichGridItem, type VideoSnapshot, VideoStatus } from "../types";
import {
  assignItemViewTransitionNames,
  buildShiftTransitionStyle,
  clearAllItemViewTransitionNames,
  extractAnimateIds,
  filterToViewport,
  prefersReducedMotion,
  reassignTransitionNames,
  withViewTransitionLock
} from "./animations";
import { buildRichItem } from "./build";
import { findShelfForSection } from "./query";
import { findRichItemIndex, videoIdFromRichItem } from "./rich-item";
import { updateVideoInDom } from "./update";

interface RepositionParams {
  freshSnapshot: VideoSnapshot;
  allSnapshots: Map<string, VideoSnapshot>;
}

export async function repositionVideoInSection({ freshSnapshot, allSnapshots }: RepositionParams) {
  // Latest band has no sectionTitle and lives at grid root; named shelves own their own contents array
  if (!freshSnapshot.sectionTitle) {
    await repositionVideoInGrid({
      freshSnapshot,
      allSnapshots
    });
    return;
  }

  await repositionVideoInShelf({
    freshSnapshot,
    allSnapshots
  });
}

async function repositionVideoInShelf({ freshSnapshot, allSnapshots }: RepositionParams) {
  const { videoId, sectionTitle, rawRenderer } = freshSnapshot;
  const elShelf = findShelfForSection(sectionTitle);
  const isShelfUsable = elShelf !== null && isPolymerElement(elShelf);
  if (!isShelfUsable) {
    updateVideoInDom({
      videoId,
      freshSnapshot
    });
    return;
  }

  const shelfContents = deepArray<InnerTubeRichGridItem>(elShelf.data, "contents");
  const iCurrent = findRichItemIndex({
    contents: shelfContents,
    videoId
  });
  if (iCurrent < 0) {
    updateVideoInDom({
      videoId,
      freshSnapshot
    });
    return;
  }

  const contentsWithoutVideo = shelfContents.filter((_, i) => i !== iCurrent);
  const iInsert = resolveInsertIndex({
    contentsWithoutVideo,
    freshSnapshot,
    allSnapshots
  });
  if (iInsert === iCurrent) {
    updateVideoInDom({
      videoId,
      freshSnapshot
    });
    return;
  }

  const newContents = [...contentsWithoutVideo];
  newContents.splice(iInsert, 0, buildRichItem(rawRenderer));

  if (prefersReducedMotion()) {
    elShelf.set("data.contents", newContents);
    updateVideoInDom({
      videoId,
      freshSnapshot
    });
    return;
  }

  clearAllItemViewTransitionNames();

  const elItems = filterToViewport(elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer"));
  assignItemViewTransitionNames(elItems);

  const animateIds = extractAnimateIds(elItems);

  const elShiftStyle = buildShiftTransitionStyle({ elItems });
  document.head.append(elShiftStyle);

  await withViewTransitionLock(async () => {
    try {
      await document.startViewTransition(() => {
        elShelf.set("data.contents", newContents);
        for (const elItem of elItems) {
          elItem.style.viewTransitionName = "";
        }
        reassignTransitionNames({
          elItems: elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer"),
          animateIds
        });
      }).finished;
    } finally {
      clearAllItemViewTransitionNames();
      elShiftStyle.remove();
    }
  });
}

async function repositionVideoInGrid({ freshSnapshot, allSnapshots }: RepositionParams) {
  const { videoId, rawRenderer } = freshSnapshot;
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  const isGridUsable = elGrid !== null && isPolymerElement(elGrid) && isRecord(elGrid.data);
  if (!isGridUsable) {
    updateVideoInDom({
      videoId,
      freshSnapshot
    });
    return;
  }

  const gridContents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents");
  const { zoneStart, zoneEnd } = resolveLatestBandZone(gridContents);
  const zoneContents = gridContents.slice(zoneStart, zoneEnd);
  const iCurrentInZone = findRichItemIndex({
    contents: zoneContents,
    videoId
  });
  if (iCurrentInZone < 0) {
    updateVideoInDom({
      videoId,
      freshSnapshot
    });
    return;
  }

  const contentsWithoutVideo = zoneContents.filter((_, i) => i !== iCurrentInZone);
  const iInsert = resolveInsertIndex({
    contentsWithoutVideo,
    freshSnapshot,
    allSnapshots
  });
  if (iInsert === iCurrentInZone) {
    updateVideoInDom({
      videoId,
      freshSnapshot
    });
    return;
  }

  const newZoneContents = [...contentsWithoutVideo];
  newZoneContents.splice(iInsert, 0, buildRichItem(rawRenderer));
  const newGridContents = [
    ...gridContents.slice(0, zoneStart),
    ...newZoneContents,
    ...gridContents.slice(zoneEnd)
  ];
  if (prefersReducedMotion()) {
    elGrid.set("data.contents", newGridContents);
    updateVideoInDom({
      videoId,
      freshSnapshot
    });
    return;
  }

  clearAllItemViewTransitionNames();

  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  const elItems = filterToViewport(
    elGridContents
      ? [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")]
      : [...document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")]
  );
  assignItemViewTransitionNames(elItems);

  const animateIds = extractAnimateIds(elItems);

  const elShiftStyle = buildShiftTransitionStyle({ elItems });
  document.head.append(elShiftStyle);

  await withViewTransitionLock(async () => {
    try {
      await document.startViewTransition(() => {
        elGrid.set("data.contents", newGridContents);
        for (const elItem of elItems) {
          elItem.style.viewTransitionName = "";
        }
        reassignTransitionNames({
          elItems: elGridContents
            ? elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")
            : document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer"),
          animateIds
        });
      }).finished;
    } finally {
      clearAllItemViewTransitionNames();
      elShiftStyle.remove();
    }
  });
}

// The Latest band runs from grid start (or first inline video) up to the first named rich shelf
function resolveLatestBandZone(contents: InnerTubeRichGridItem[]) {
  let zoneEnd = contents.length;
  for (let i = 0; i < contents.length; i++) {
    if (deepRecord(contents[i], "richSectionRenderer", "content", "richShelfRenderer")) {
      zoneEnd = i;
      break;
    }
  }

  let zoneStart = 0;
  while (zoneStart < zoneEnd) {
    const item = contents[zoneStart];
    const isBandBoundary = videoIdFromRichItem(item) !== null
      || deepRecord(item, "richSectionRenderer", "content", "richShelfRenderer") !== null;
    if (isBandBoundary) {
      break;
    }

    zoneStart++;
  }

  return {
    zoneStart,
    zoneEnd
  };
}

function resolveInsertIndex({
  contentsWithoutVideo,
  freshSnapshot,
  allSnapshots
}: {
  contentsWithoutVideo: InnerTubeRichGridItem[];
  freshSnapshot: VideoSnapshot;
  allSnapshots: Map<string, VideoSnapshot>;
}) {
  const targetSecondsAgo = parseSecondsAgo(freshSnapshot.publishedTimeText);

  // Slot in by publishedTimeText: newest first; live items don't compete on time and are skipped here
  let iInsert = contentsWithoutVideo.length;
  for (let i = 0; i < contentsWithoutVideo.length; i++) {
    const itemVideoId = videoIdFromRichItem(contentsWithoutVideo[i]);
    if (!itemVideoId) {
      continue;
    }

    const itemSnapshot = allSnapshots.get(itemVideoId);
    if (!itemSnapshot || itemSnapshot.status === VideoStatus.Live) {
      continue;
    }

    if (parseSecondsAgo(itemSnapshot.publishedTimeText) >= targetSecondsAgo) {
      iInsert = i;
      break;
    }
  }

  if (freshSnapshot.status === VideoStatus.Live) {
    return iInsert;
  }

  // Non-live videos must never overtake the leading live cluster
  let leadingLiveSplice = 0;
  for (let i = 0; i < contentsWithoutVideo.length; i++) {
    const itemVideoId = videoIdFromRichItem(contentsWithoutVideo[i]);
    if (!itemVideoId) {
      continue;
    }

    const itemSnapshot = allSnapshots.get(itemVideoId);
    if (itemSnapshot?.status !== VideoStatus.Live) {
      break;
    }

    leadingLiveSplice = i + 1;
  }
  return Math.max(iInsert, leadingLiveSplice);
}
