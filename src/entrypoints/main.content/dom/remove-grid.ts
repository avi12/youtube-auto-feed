import { assignItemViewTransitionNames, buildRemoveTransitionStyle, buildShiftTransitionStyle, clearAllItemViewTransitionNames, clearItemViewTransitionNames } from "../animations";
import { deepArray, isPolymerElement, isRecord, videoIdFromData } from "../helpers";
import type { PolymerElement } from "../types";
import { filterOutRichItems } from "./rich-item";
import type { ItemInfo } from "./remove";

export async function removeGridItems(items: ItemInfo[], allRequestedVideoIds: string[]) {
  const gridItems = items.filter(({ container }) => container === "grid");
  const foundVideoIds = new Set(items.map(({ videoId }) => videoId));

  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  cleanupOrphanIdsInGridData(elGrid, allRequestedVideoIds, foundVideoIds);

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

  if (onScreenGridElements.length === 0) {
    removeAllOrNothing(elGrid, gridVideoIdSet, allGridElements);
    return;
  }

  await removeGridItemsAnimated(elGrid, gridVideoIdSet, allGridElements);
}

function cleanupOrphanIdsInGridData(
  elGrid: HTMLElement | null,
  allRequestedVideoIds: string[],
  foundVideoIds: Set<string>
) {
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

  const unfoundVideoIds = allRequestedVideoIds.filter(id => !foundVideoIds.has(id));
  if (unfoundVideoIds.length === 0) {
    return;
  }

  const unfoundSet = new Set(unfoundVideoIds);
  const currentContents = deepArray(elGrid.data, "contents");
  const filteredContents = filterOutRichItems(currentContents, unfoundSet);
  if (filteredContents.length < currentContents.length) {
    elGrid.set("data.contents", filteredContents);
  }
}

function removeAllOrNothing(elGrid: PolymerElement, gridVideoIdSet: Set<string>, allGridElements: HTMLElement[]) {
  const currentContents = deepArray(elGrid.data, "contents");
  const filteredContents = filterOutRichItems(currentContents, gridVideoIdSet);

  if (filteredContents.length < currentContents.length) {
    elGrid.set("data.contents", filteredContents);
  } else {
    for (const elItem of allGridElements) {
      elItem.remove();
    }
  }
}

async function removeGridItemsAnimated(
  elGrid: PolymerElement,
  gridVideoIdSet: Set<string>,
  allGridElements: HTMLElement[]
) {
  clearAllItemViewTransitionNames();

  const removedElSet = new Set(allGridElements);
  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  const { elElementsAfterFirstRemoved, elSectionsAfterFirstRemoved } = collectShiftTargets(elGridContents, removedElSet);

  assignItemViewTransitionNames(elElementsAfterFirstRemoved);

  const shiftCount = elElementsAfterFirstRemoved.length;
  const shiftDelayPerItemMs = shiftCount > 1 ? Math.min(80 / (shiftCount - 1), 20) : 0;

  const animateIds = new Set(
    elElementsAfterFirstRemoved
      .filter(isPolymerElement)
      .map(el => videoIdFromData(el.data))
      .filter((id): id is string => id !== null && id !== "")
  );

  for (const elItem of allGridElements) {
    if (!isPolymerElement(elItem)) continue;
    const id = videoIdFromData(elItem.data);
    if (id && elItem.getBoundingClientRect().top <= innerHeight) {
      elItem.style.viewTransitionName = `ytsua-item-${id}`;
    }
  }

  const elShiftStyle = buildShiftTransitionStyle(elElementsAfterFirstRemoved, new Set(), shiftDelayPerItemMs);
  const elRemoveStyle = buildRemoveTransitionStyle(allGridElements);
  document.head.append(elShiftStyle);
  document.head.append(elRemoveStyle);

  const transition = document.startViewTransition(() => {
    const currentContents = deepArray(elGrid.data, "contents");
    const filteredContents = filterOutRichItems(currentContents, gridVideoIdSet);

    for (const elItem of allGridElements) {
      elItem.remove();
    }
    if (filteredContents.length < currentContents.length) {
      elGrid.set("data.contents", filteredContents);
    }

    for (const elItem of allGridElements) {
      elItem.style.viewTransitionName = "";
    }
    for (const elItem of elElementsAfterFirstRemoved) {
      elItem.style.viewTransitionName = "";
    }
    const reassignedIds = new Set<string>();
    for (const elItem of elGridContents?.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer") ?? []) {
      if (!isPolymerElement(elItem)) continue;
      const id = videoIdFromData(elItem.data);
      if (id && animateIds.has(id) && !reassignedIds.has(id)) {
        reassignedIds.add(id);
        elItem.style.viewTransitionName = `ytsua-item-${id}`;
      }
    }
  });

  try {
    await transition.finished;
  } finally {
    elShiftStyle.remove();
    elRemoveStyle.remove();
    clearItemViewTransitionNames(elElementsAfterFirstRemoved);
    clearItemViewTransitionNames(elSectionsAfterFirstRemoved);
    for (const elItem of allGridElements) {
      elItem.style.viewTransitionName = "";
    }
    clearAllItemViewTransitionNames();
  }
}

function collectShiftTargets(elGridContents: HTMLElement | null, removedElSet: Set<HTMLElement>) {
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

  return { elElementsAfterFirstRemoved, elSectionsAfterFirstRemoved };
}
