import {
  assignItemViewTransitionNames,
  buildStaggerStyle,
  clearItemViewTransitionNames
} from "../animations";
import { deepArray, deepRecord, deepString, isPolymerElement, isRecord } from "../helpers";
import { filterOutRichItems } from "./content";
import type { ItemInfo } from "./remove";

type ShelfGroup = { videoIds: string[]; elOnScreenItems: HTMLElement[]; };

export async function removeRichShelfItems(items: ItemInfo[]) {
  const groups = new Map<HTMLElement, ShelfGroup>();
  for (const { container, isOffScreen, videoId, elItem, elRichShelf } of items) {
    if (container !== "richShelf" || isOffScreen || !elRichShelf) {
      continue;
    }

    const group = groups.get(elRichShelf) ?? { videoIds: [], elOnScreenItems: [] };
    group.videoIds.push(videoId);
    group.elOnScreenItems.push(elItem);
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

  const elSiblings = [...elRichShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")].filter(
    elSibling => !group.elOnScreenItems.includes(elSibling)
  );
  assignItemViewTransitionNames(elSiblings);

  try {
    await document.startViewTransition(() => {
      if (filteredShelfContents.length < shelfContents.length) {
        elRichShelf.set("data.contents", filteredShelfContents);
      } else {
        for (const elItem of group.elOnScreenItems) {
          elItem.remove();
        }
      }
    }).finished;
  } finally {
    clearItemViewTransitionNames(elSiblings);
  }

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
  assignItemViewTransitionNames(elItemsAfterSection);
  const elStaggerStyle = buildStaggerStyle(elItemsAfterSection);
  document.head.append(elStaggerStyle);

  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  try {
    await document.startViewTransition(() => {
      if (tryRemoveSectionViaGridData(elGrid, shelfTitle)) {
        return;
      }
      elSection.remove();
    }).finished;
  } finally {
    elStaggerStyle.remove();
    clearItemViewTransitionNames(elItemsAfterSection);
    clearItemViewTransitionNames(elSectionsAfterSection);
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

    const shelf = isRecord(sectionContent.richShelfRenderer)
      ? sectionContent.richShelfRenderer
      : isRecord(sectionContent.shelfRenderer)
        ? sectionContent.shelfRenderer
        : null;
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
  for (const { container, isOffScreen, videoId, elItem, elInnerShelf } of items) {
    if (container !== "innerShelf" || isOffScreen || !elInnerShelf) {
      continue;
    }

    const group = groups.get(elInnerShelf) ?? { videoIds: [], elOnScreenItems: [] };
    group.videoIds.push(videoId);
    group.elOnScreenItems.push(elItem);
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

  const elSiblings = [...elInnerShelf.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")].filter(
    elSibling => !group.elOnScreenItems.includes(elSibling)
  );
  assignItemViewTransitionNames(elSiblings);

  try {
    await document.startViewTransition(() => {
      if (filteredListItems.length < listItems.length) {
        elInnerShelf.set(listPath, filteredListItems);
      } else {
        for (const elItem of group.elOnScreenItems) {
          elItem.remove();
        }
      }
    }).finished;
  } finally {
    clearItemViewTransitionNames(elSiblings);
  }
}
