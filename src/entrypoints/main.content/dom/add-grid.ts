import {
  assignItemViewTransitionNames,
  buildStaggerStyle,
  clearItemViewTransitionNames,
  triggerAnimation
} from "../animations";
import { deepArray, isPolymerElement, isRecord, videoIdFromData } from "../helpers";
import { type PolymerElement, type VideoSnapshot } from "../types";
import { addSectionToDom } from "./add-section";
import { sortByFreshOrder, videoIdFromRichItem } from "./content";
import { buildRichItem } from "./renderer";

export async function addVideosToGridDom(videosToAdd: VideoSnapshot[], allFreshSnapshots: VideoSnapshot[]) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid)) {
    const processedSectionTitles = new Set<string>();
    for (const { sectionTitle } of videosToAdd) {
      if (processedSectionTitles.has(sectionTitle)) {
        continue;
      }

      processedSectionTitles.add(sectionTitle);
      await addSectionToDom(sectionTitle, allFreshSnapshots.filter(video => video.sectionTitle === sectionTitle));
    }
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
  const sortedVideos = sortByFreshOrder(videosToAdd, freshOrderMap);

  const newContents = [...deepArray(elGrid.data, "contents")];
  const newElements: HTMLElement[] = [];
  for (const { videoId, rawRenderer } of sortedVideos) {
    const freshIndex = freshOrderMap.get(videoId) ?? 0;
    const iInsert = findGridInsertIndex(newContents, freshIndex, freshOrderMap);
    const richItem = buildRichItem(rawRenderer);
    newContents.splice(iInsert, 0, richItem);

    const elNewItem = document.createElement("ytd-rich-item-renderer");
    (elNewItem as PolymerElement).data = richItem.richItemRenderer;
    newElements.push(elNewItem);
  }

  const elAllItems = [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")];
  const { elElementsToAnimate, elSectionsToAnimate } = collectGridShiftTargets(elGridContents, elAllItems, sortedVideos, freshOrderMap);

  assignItemViewTransitionNames(elAllItems);
  const elStaggerStyle = buildStaggerStyle(elElementsToAnimate);
  document.head.append(elStaggerStyle);

  const transition = document.startViewTransition(() => {
    elGrid.set("data.contents", newContents);
    for (let iNew = 0; iNew < sortedVideos.length; iNew++) {
      const freshIndex = freshOrderMap.get(sortedVideos[iNew].videoId) ?? 0;
      const elBefore = findDomInsertSibling(elGridContents, freshIndex, freshOrderMap);
      elGridContents.insertBefore(newElements[iNew], elBefore);
    }
  });

  try {
    await transition.finished;
  } finally {
    elStaggerStyle.remove();
    clearItemViewTransitionNames(elAllItems);
    clearItemViewTransitionNames(elSectionsToAnimate);
  }

  for (let iNewItem = 0; iNewItem < newElements.length; iNewItem++) {
    const elNewItem = newElements[iNewItem];
    elNewItem.style.setProperty("--ytsua-new-index", String(iNewItem));
    elNewItem.style.setProperty("--ytsua-new-count", String(newElements.length));
    triggerAnimation(elNewItem, "ytsua-new");
  }
}

function findGridInsertIndex(contents: unknown[], freshIndex: number, freshOrderMap: Map<string, number>) {
  const iBefore = contents.findIndex(contentItem => {
    const existingId = videoIdFromRichItem(contentItem);
    if (!existingId) {
      return false;
    }
    return (freshOrderMap.get(existingId) ?? Infinity) > freshIndex;
  });
  return iBefore >= 0 ? iBefore : contents.length;
}

function findDomInsertSibling(elGridContents: HTMLElement, freshIndex: number, freshOrderMap: Map<string, number>) {
  for (const elChild of elGridContents.children) {
    if (elChild.tagName !== "YTD-RICH-ITEM-RENDERER" || !isPolymerElement(elChild)) {
      continue;
    }

    const existingId = videoIdFromData(elChild.data);
    if (!existingId) {
      continue;
    }

    if ((freshOrderMap.get(existingId) ?? Infinity) > freshIndex) {
      return elChild;
    }
  }
  return null;
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
