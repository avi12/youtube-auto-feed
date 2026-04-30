import type { ItemInfo } from "./remove";
import {
  assignItemViewTransitionNames,
  buildRemoveTransitionStyle,
  buildShiftTransitionStyle,
  calculateStaggerDelayMs,
  clearAllItemViewTransitionNames,
  clearItemViewTransitionNames,
  extractAnimateIds,
  filterToViewport,
  reassignTransitionNames
} from "../animations";
import {
  deepArray, deepRecord, deepString, isPolymerElement, isRecord, videoIdFromData 
} from "../helpers";
import { filterOutRichItems } from "./rich-item";

type ShelfGroup = { videoIds: string[]; elOnScreenItems: HTMLElement[]; };

async function removeItemsFromShelf(
  elShelf: HTMLElement,
  group: ShelfGroup,
  itemSelector: string,
  applyFilteredContents: () => void
) {
  clearAllItemViewTransitionNames();

  const elSiblings = filterToViewport(
    [...elShelf.querySelectorAll<HTMLElement>(itemSelector)].filter(
      elSibling => !group.elOnScreenItems.includes(elSibling)
    )
  );
  assignItemViewTransitionNames(elSiblings);

  const animateIds = extractAnimateIds(elSiblings);

  for (const elItem of group.elOnScreenItems) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (videoId) {
      elItem.style.viewTransitionName = `ytsua-item-${videoId}`;
    }
  }

  const elShiftStyle = buildShiftTransitionStyle(elSiblings, new Set(), calculateStaggerDelayMs(elSiblings.length));
  const elRemoveStyle = buildRemoveTransitionStyle(group.elOnScreenItems);
  document.head.append(elShiftStyle);
  document.head.append(elRemoveStyle);

  try {
    await document.startViewTransition(() => {
      for (const elItem of group.elOnScreenItems) {
        elItem.remove();
      }
      applyFilteredContents();
      for (const elItem of group.elOnScreenItems) {
        elItem.style.viewTransitionName = "";
      }
      for (const elItem of elSiblings) {
        elItem.style.viewTransitionName = "";
      }
      reassignTransitionNames(elShelf.querySelectorAll<HTMLElement>(itemSelector), animateIds);
    }).finished;
  } finally {
    clearItemViewTransitionNames(elSiblings);
    for (const elItem of group.elOnScreenItems) {
      elItem.style.viewTransitionName = "";
    }
    elShiftStyle.remove();
    elRemoveStyle.remove();
    clearAllItemViewTransitionNames();
  }
}

export async function removeRichShelfItems(items: ItemInfo[]) {
  const groups = new Map<HTMLElement, ShelfGroup>();
  for (const {
    container, isOffScreen, videoId, elItem, elRichShelf 
  } of items) {
    if (container !== "richShelf" || !elRichShelf) {
      continue;
    }

    const group = groups.get(elRichShelf) ?? { videoIds: [], elOnScreenItems: [] };
    group.videoIds.push(videoId);
    if (!isOffScreen) {
      group.elOnScreenItems.push(elItem);
    }

    groups.set(elRichShelf, group);
  }
  for (const [elRichShelf, group] of groups) {
    await removeRichShelfGroup(elRichShelf, group);
  }
}

async function removeRichShelfGroup(elRichShelf: HTMLElement, group: ShelfGroup) {
  if (!isPolymerElement(elRichShelf)) {
    return;
  }

  const shelfData = elRichShelf.data;
  if (!isRecord(shelfData)) {
    for (const elItem of group.elOnScreenItems) {
      elItem.remove();
    }
    return;
  }

  const shelfTitle = deepString(shelfData, "title", "runs", "0", "text");
  const shelfVideoIdSet = new Set(group.videoIds);
  const shelfContents = deepArray(shelfData, "contents");
  const filteredShelfContents = filterOutRichItems(shelfContents, shelfVideoIdSet);

  await removeItemsFromShelf(elRichShelf, group, "ytd-rich-item-renderer", () => {
    if (filteredShelfContents.length < shelfContents.length) {
      elRichShelf.set("data.contents", filteredShelfContents);
    }
  });

  if (filteredShelfContents.length === 0) {
    await removeEmptyShelfSection(elRichShelf, shelfTitle);
  }
}

async function removeEmptyShelfSection(elRichShelf: HTMLElement, shelfTitle: string) {
  const elSection = elRichShelf.closest<HTMLElement>("ytd-rich-section-renderer");
  if (!elSection) {
    return;
  }

  elSection.classList.add("ytsua-section-removing");
  await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, 400);
    elSection.addEventListener("transitionend", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

  const elSectionParent = elSection.parentElement;
  const elItemsAfterSection: HTMLElement[] = [];
  const elSectionsAfterSection: HTMLElement[] = [];
  let iSectionIndex = 0;
  let isPastSection = false;
  for (const elSibling of elSectionParent?.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer, :scope > ytd-rich-section-renderer") ?? []) {
    if (elSibling === elSection) {
      isPastSection = true;
      continue;
    }

    if (isPastSection) {
      elItemsAfterSection.push(elSibling);
      if (elSibling.tagName === "YTD-RICH-SECTION-RENDERER") {
        elSibling.style.viewTransitionName = `ytsua-section-rem-${iSectionIndex++}`;
        elSectionsAfterSection.push(elSibling);
      }
    }
  }

  clearAllItemViewTransitionNames();
  assignItemViewTransitionNames(elItemsAfterSection);

  const afterSectionAnimateIds = extractAnimateIds(
    elItemsAfterSection.filter(elItem => elItem.tagName === "YTD-RICH-ITEM-RENDERER")
  );

  const elShiftStyle = buildShiftTransitionStyle(elItemsAfterSection, new Set(), calculateStaggerDelayMs(elItemsAfterSection.length));
  document.head.append(elShiftStyle);

  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  const elGridContents = elGrid?.querySelector<HTMLElement>("#contents");
  try {
    await document.startViewTransition(() => {
      elSection.remove();
      tryRemoveSectionViaGridData(elGrid, shelfTitle);
      for (const elItem of elItemsAfterSection) {
        if (elItem.tagName === "YTD-RICH-ITEM-RENDERER") {
          elItem.style.viewTransitionName = "";
        }
      }
      reassignTransitionNames(
        elGridContents?.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer") ?? [],
        afterSectionAnimateIds
      );
    }).finished;
  } finally {
    elShiftStyle.remove();
    clearItemViewTransitionNames(elItemsAfterSection);
    clearItemViewTransitionNames(elSectionsAfterSection);
    clearAllItemViewTransitionNames();
  }
}

function tryRemoveSectionViaGridData(elGrid: HTMLElement | null, shelfTitle: string) {
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return false;
  }

  const currentGridContents = deepArray(elGrid.data, "contents");
  const filteredGridContents = currentGridContents.filter(item => {
    const sectionContent = deepRecord(item, "richSectionRenderer", "content");
    if (!isRecord(sectionContent)) {
      return true;
    }

    let shelf: Record<string, unknown> | null = null;
    if (isRecord(sectionContent.richShelfRenderer)) {
      shelf = sectionContent.richShelfRenderer;
    } else if (isRecord(sectionContent.shelfRenderer)) {
      shelf = sectionContent.shelfRenderer;
    }

    if (!shelf) {
      return true;
    }

    const title = deepString(shelf, "title", "runs", "0", "text");
    return !shelfTitle || !title || title !== shelfTitle;
  });

  if (filteredGridContents.length === currentGridContents.length) {
    return false;
  }

  elGrid.set("data.contents", filteredGridContents);
  return true;
}

export async function removeInnerShelfItems(items: ItemInfo[]) {
  const groups = new Map<HTMLElement, ShelfGroup>();
  for (const {
    container, isOffScreen, videoId, elItem, elInnerShelf 
  } of items) {
    if (container !== "innerShelf" || !elInnerShelf) {
      continue;
    }

    const group = groups.get(elInnerShelf) ?? { videoIds: [], elOnScreenItems: [] };
    group.videoIds.push(videoId);
    if (!isOffScreen) {
      group.elOnScreenItems.push(elItem);
    }

    groups.set(elInnerShelf, group);
  }
  for (const [elInnerShelf, group] of groups) {
    await removeInnerShelfGroup(elInnerShelf, group);
  }
}

async function removeInnerShelfGroup(elInnerShelf: HTMLElement, group: ShelfGroup) {
  if (!isPolymerElement(elInnerShelf)) {
    return;
  }

  const shelfData = elInnerShelf.data;
  if (!isRecord(shelfData)) {
    for (const elItem of group.elOnScreenItems) {
      elItem.remove();
    }
    return;
  }

  const { content } = shelfData;
  if (!isRecord(content)) {
    for (const elItem of group.elOnScreenItems) {
      elItem.remove();
    }
    return;
  }

  const innerShelfVideoIdSet = new Set(group.videoIds);
  const isHorizontalList = isRecord(content.horizontalListRenderer);
  const listPath = isHorizontalList ? "data.content.horizontalListRenderer.items" : "data.content.gridRenderer.items";
  const listItems = deepArray(isHorizontalList ? content.horizontalListRenderer : content.gridRenderer, "items");
  const filteredListItems = listItems.filter(
    item => !innerShelfVideoIdSet.has(deepString(item, "videoRenderer", "videoId"))
      && !innerShelfVideoIdSet.has(deepString(item, "gridVideoRenderer", "videoId"))
  );

  await removeItemsFromShelf(elInnerShelf, group, "ytd-grid-video-renderer", () => {
    if (filteredListItems.length < listItems.length) {
      elInnerShelf.set(listPath, filteredListItems);
    }
  });
}
