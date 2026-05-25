import { deepArray, isPolymerElement, isRecord } from "../../helpers";
import type { InnerTubeRichGridItem, PolymerElement } from "../../types";
import {
  animateItemsOut,
  assignItemViewTransitionNames,
  buildShiftTransitionStyle,
  calculateStaggerDelayMs,
  clearAllItemViewTransitionNames,
  clearItemViewTransitionNames,
  extractAnimateIds,
  isInViewport,
  prefersReducedMotion,
  reassignTransitionNames,
  withViewTransitionLock
} from "../animations";
import { filterOutRichItems } from "../rich-item";
import type { ItemInfo } from "./index";

export async function removeGridItems({ items, allRequestedVideoIds }: {
  items: ItemInfo[];
  allRequestedVideoIds: string[];
}) {
  const gridItems = items.filter(({ container }) => container === "grid");
  const foundVideoIds = new Set(items.map(({ videoId }) => videoId));

  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  cleanupOrphanIdsInGridData({
    elGrid,
    allRequestedVideoIds,
    foundVideoIds
  });

  if (gridItems.length === 0) {
    return;
  }

  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    for (const { elItem } of gridItems) {
      elItem.remove();
    }
    return;
  }

  const gridVideoIdSet = new Set(gridItems.map(({ videoId }) => videoId));
  const allGridElements = gridItems.map(({ elItem }) => elItem);
  const onScreenGridElements = gridItems.filter(({ isOffScreen }) => !isOffScreen).map(({ elItem }) => elItem);
  if (onScreenGridElements.length === 0 || prefersReducedMotion()) {
    removeAllOrNothing({
      elGrid,
      gridVideoIdSet,
      allGridElements
    });
    return;
  }

  await removeGridItemsAnimated({
    elGrid,
    gridVideoIdSet,
    allGridElements
  });
}

function cleanupOrphanIdsInGridData({
  elGrid,
  allRequestedVideoIds,
  foundVideoIds
}: {
  elGrid: HTMLElement | null;
  allRequestedVideoIds: string[];
  foundVideoIds: Set<string>;
}) {
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const unfoundVideoIds = allRequestedVideoIds.filter(videoId => !foundVideoIds.has(videoId));
  if (unfoundVideoIds.length === 0) {
    return;
  }

  const unfoundSet = new Set(unfoundVideoIds);
  const currentContents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents");
  const filteredContents = filterOutRichItems({
    contents: currentContents,
    excludeVideoIds: unfoundSet
  });
  if (filteredContents.length < currentContents.length) {
    elGrid.set("data.contents", filteredContents);
  }
}

function removeAllOrNothing({ elGrid, gridVideoIdSet, allGridElements }: {
  elGrid: PolymerElement;
  gridVideoIdSet: Set<string>;
  allGridElements: HTMLElement[];
}) {
  const currentContents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents");
  const filteredContents = filterOutRichItems({
    contents: currentContents,
    excludeVideoIds: gridVideoIdSet
  });
  if (filteredContents.length < currentContents.length) {
    elGrid.set("data.contents", filteredContents);
  } else {
    for (const elItem of allGridElements) {
      elItem.remove();
    }
  }
}

async function removeGridItemsAnimated({ elGrid, gridVideoIdSet, allGridElements }: {
  elGrid: PolymerElement;
  gridVideoIdSet: Set<string>;
  allGridElements: HTMLElement[];
}) {
  clearAllItemViewTransitionNames();

  const removedElSet = new Set(allGridElements);
  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  const { elElementsAfterFirstRemoved, elSectionsAfterFirstRemoved } = collectShiftTargets({
    elGridContents,
    removedElSet
  });

  assignItemViewTransitionNames(elElementsAfterFirstRemoved);

  const shiftDelayPerItemMs = calculateStaggerDelayMs(elElementsAfterFirstRemoved.length);
  const animateIds = extractAnimateIds(elElementsAfterFirstRemoved);

  await animateItemsOut(allGridElements.filter(isInViewport));

  const elShiftStyle = buildShiftTransitionStyle({
    elItems: elElementsAfterFirstRemoved,
    excludeNames: new Set(),
    delayPerItemMs: shiftDelayPerItemMs
  });
  document.head.append(elShiftStyle);

  await withViewTransitionLock(async () => {
    try {
      await document.startViewTransition(() => {
        const currentContents = deepArray<InnerTubeRichGridItem>(elGrid.data, "contents");
        const filteredContents = filterOutRichItems({
          contents: currentContents,
          excludeVideoIds: gridVideoIdSet
        });

        for (const elItem of allGridElements) {
          elItem.remove();
        }

        if (filteredContents.length < currentContents.length) {
          elGrid.set("data.contents", filteredContents);
        }

        for (const elItem of elElementsAfterFirstRemoved) {
          elItem.style.viewTransitionName = "";
        }
        reassignTransitionNames({
          elItems: elGridContents?.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer") ?? [],
          animateIds
        });
      }).finished;
    } finally {
      elShiftStyle.remove();
      clearItemViewTransitionNames(elElementsAfterFirstRemoved);
      clearItemViewTransitionNames(elSectionsAfterFirstRemoved);
      clearAllItemViewTransitionNames();
    }
  });
}

function collectShiftTargets({ elGridContents, removedElSet }: {
  elGridContents: HTMLElement | null;
  removedElSet: Set<HTMLElement>;
}) {
  const elElementsAfterFirstRemoved: HTMLElement[] = [];
  const elSectionsAfterFirstRemoved: HTMLElement[] = [];
  let isAfterFirstRemoved = false;
  let iSection = 0;

  for (const elChild of elGridContents?.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer, :scope > ytd-rich-section-renderer") ?? []) {
    if (removedElSet.has(elChild)) {
      isAfterFirstRemoved = true;
      continue;
    }

    if (!isAfterFirstRemoved) {
      continue;
    }

    const isOffScreen = elChild.getBoundingClientRect().top > innerHeight;
    if (isOffScreen) {
      continue;
    }

    elElementsAfterFirstRemoved.push(elChild);

    if (elChild.tagName === "YTD-RICH-SECTION-RENDERER") {
      elChild.style.viewTransitionName = `ytsua-section-${iSection}`;
      elSectionsAfterFirstRemoved.push(elChild);
      iSection++;
    }
  }

  return {
    elElementsAfterFirstRemoved,
    elSectionsAfterFirstRemoved
  };
}
