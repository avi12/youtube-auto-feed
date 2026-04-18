import {
  assignItemViewTransitionNames,
  buildStaggerStyle,
  clearItemViewTransitionNames,
  triggerAnimation
} from "../animations";
import { deepArray, deepRecord, deepString, isPolymerElement, isRecord, videoIdFromData } from "../helpers";
import { isVideoRenderer } from "../parse";
import { type VideoSnapshot } from "../types";
import { addSectionToDom } from "./add-section";
import { findItemElement } from "./query";
import { sortByFreshOrder, videoIdFromRichItem } from "./rich-item";
import { buildRichItem } from "./build";

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

  const modelSectionTitles = new Set(
    deepArray(elGrid.data, "contents")
      .flatMap(item => [
        deepString(item, "richSectionRenderer", "content", "richShelfRenderer", "title", "runs", "0", "text"),
        deepString(item, "richSectionRenderer", "content", "shelfRenderer", "title", "runs", "0", "text")
      ])
      .filter(title => title !== "")
  );
  const standaloneVideos = sortedVideos.filter(video => !modelSectionTitles.has(video.sectionTitle));

  let actuallyAddedVideos: VideoSnapshot[] = [];

  const elAllItems = [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")];
  const { elElementsToAnimate, elSectionsToAnimate } = standaloneVideos.length > 0
    ? collectGridShiftTargets(elGridContents, elAllItems, standaloneVideos, freshOrderMap)
    : { elElementsToAnimate: [] as HTMLElement[], elSectionsToAnimate: [] as HTMLElement[] };

  assignItemViewTransitionNames(elAllItems);
  const elStaggerStyle = buildStaggerStyle(elElementsToAnimate);
  document.head.append(elStaggerStyle);

  try {
    await document.startViewTransition(() => {
      // Read model+DOM inside the callback — no concurrent JS can run here,
      // so this is the safest moment to check for YouTube's own DOM additions.
      const presentIds = readGridVideoIds(elGrid, elGridContents);
      const videosToInsert = sortedVideos.filter(video => !presentIds.has(video.videoId));
      if (videosToInsert.length === 0) {
        return;
      }

      const newContents = [...deepArray(elGrid.data, "contents")];
      for (const video of videosToInsert) {
        const { videoId, rawRenderer, sectionTitle } = video;
        const iSection = sectionTitle ? newContents.findIndex(item =>
          deepString(item, "richSectionRenderer", "content", "richShelfRenderer", "title", "runs", "0", "text") === sectionTitle ||
          deepString(item, "richSectionRenderer", "content", "shelfRenderer", "title", "runs", "0", "text") === sectionTitle
        ) : -1;

        if (iSection >= 0) {
          const section = deepRecord(newContents[iSection], "richSectionRenderer");
          const content = deepRecord(section, "content");
          const richShelf = deepRecord(content, "richShelfRenderer");
          if (section && content && richShelf) {
            const shelfContents = deepArray(richShelf, "contents");
            if (!shelfContents.some(item => videoIdFromRichItem(item) === videoId)) {
              newContents[iSection] = {
                richSectionRenderer: {
                  ...section,
                  content: {
                    ...content,
                    richShelfRenderer: { ...richShelf, contents: [buildRichItem(rawRenderer), ...shelfContents] }
                  }
                }
              };
            }
          } else if (section && content) {
            const innerShelf = deepRecord(content, "shelfRenderer");
            if (innerShelf && isVideoRenderer(rawRenderer)) {
              const innerContent: Record<string, unknown> = deepRecord(innerShelf, "content") ?? {};
              const horizontalList = deepRecord(innerContent, "horizontalListRenderer");
              const gridList = deepRecord(innerContent, "gridRenderer");
              const listKey = horizontalList ? "horizontalListRenderer" : (gridList ? "gridRenderer" : "horizontalListRenderer");
              const existingList: Record<string, unknown> = horizontalList ?? gridList ?? {};
              const items = deepArray(existingList, "items");
              const isAlreadyPresent = items.some(item =>
                deepString(item, "videoRenderer", "videoId") === videoId ||
                deepString(item, "gridVideoRenderer", "videoId") === videoId
              );
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
                          [listKey]: { ...existingList, items: [{ videoRenderer: rawRenderer }, ...items] }
                        }
                      }
                    }
                  }
                };
              }
            }
          }
        } else {
          const freshIndex = freshOrderMap.get(videoId) ?? 0;
          const iInsert = findGridInsertIndex(newContents, freshIndex, freshOrderMap);
          newContents.splice(iInsert, 0, buildRichItem(rawRenderer));
          actuallyAddedVideos.push(video);
        }
      }
      elGrid.set("data.contents", newContents);
    }).finished;
  } finally {
    elStaggerStyle.remove();
    clearItemViewTransitionNames(elAllItems);
    clearItemViewTransitionNames(elSectionsToAnimate);
  }

  cleanOrphanedGridItems();

  for (const elSection of document.querySelectorAll<HTMLElement>("ytd-rich-section-renderer.ytsua-section-removing")) {
    elSection.classList.remove("ytsua-section-removing");
  }

  for (let iNewItem = 0; iNewItem < actuallyAddedVideos.length; iNewItem++) {
    const elNewItem = findItemElement(actuallyAddedVideos[iNewItem].videoId);
    if (elNewItem) {
      elNewItem.style.setProperty("--ytsua-new-index", String(iNewItem));
      elNewItem.style.setProperty("--ytsua-new-count", String(actuallyAddedVideos.length));
      triggerAnimation(elNewItem, "ytsua-new");
    }
  }
}

function readGridVideoIds(elGrid: HTMLElement, elGridContents: HTMLElement) {
  const ids = new Set<string>();
  for (const item of deepArray(elGrid.data, "contents")) {
    const topId = videoIdFromRichItem(item);
    if (topId) {
      ids.add(topId);
      continue;
    }
    for (const shelfItem of deepArray(item, "richSectionRenderer", "content", "richShelfRenderer", "contents")) {
      const shelfId = videoIdFromRichItem(shelfItem);
      if (shelfId) ids.add(shelfId);
    }
    for (const listItem of shelfRendererListItems(item)) {
      const videoId = deepString(listItem, "videoRenderer", "videoId") || deepString(listItem, "gridVideoRenderer", "videoId");
      if (videoId) ids.add(videoId);
    }
  }
  for (const elItem of elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")) {
    if (!isPolymerElement(elItem)) continue;
    const id = videoIdFromData(elItem.data);
    if (id) ids.add(id);
  }
  return ids;
}

function shelfRendererListItems(contentItem: unknown) {
  return [
    ...deepArray(contentItem, "richSectionRenderer", "content", "shelfRenderer", "content", "horizontalListRenderer", "items"),
    ...deepArray(contentItem, "richSectionRenderer", "content", "shelfRenderer", "content", "gridRenderer", "items")
  ];
}

export function cleanOrphanedGridItems() {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) return;
  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  if (!elGridContents) return;

  const standaloneModelIds = new Set<string>();
  const standaloneModelDuplicates = new Set<string>();
  const sectionIds = new Set<string>();

  for (const item of deepArray(elGrid.data, "contents")) {
    const topId = videoIdFromRichItem(item);
    if (topId) {
      if (standaloneModelIds.has(topId)) {
        standaloneModelDuplicates.add(topId);
      } else {
        standaloneModelIds.add(topId);
      }
    } else {
      for (const shelfItem of deepArray(item, "richSectionRenderer", "content", "richShelfRenderer", "contents")) {
        const shelfId = videoIdFromRichItem(shelfItem);
        if (shelfId) sectionIds.add(shelfId);
      }
      for (const listItem of shelfRendererListItems(item)) {
        const videoId = deepString(listItem, "videoRenderer", "videoId") || deepString(listItem, "gridVideoRenderer", "videoId");
        if (videoId) sectionIds.add(videoId);
      }
    }
  }

  const misplacedIds = new Set([...standaloneModelIds].filter(id => sectionIds.has(id)));
  if (misplacedIds.size > 0 || standaloneModelDuplicates.size > 0) {
    const seenDuplicates = new Set<string>();
    const filteredContents = deepArray(elGrid.data, "contents").filter(item => {
      const id = videoIdFromRichItem(item);
      if (!id) return true;
      if (misplacedIds.has(id)) return false;
      if (standaloneModelDuplicates.has(id)) {
        if (seenDuplicates.has(id)) return false;
        seenDuplicates.add(id);
      }
      return true;
    });
    elGrid.set("data.contents", filteredContents);
    for (const id of misplacedIds) standaloneModelIds.delete(id);
  }

  const modelGroups: Set<string>[] = [new Set<string>()];
  for (const item of deepArray(elGrid.data, "contents")) {
    const id = videoIdFromRichItem(item);
    if (id) {
      modelGroups[modelGroups.length - 1].add(id);
    } else if (isRecord(item) && "richSectionRenderer" in item) {
      modelGroups.push(new Set<string>());
    }
  }

  let domGroupIndex = 0;
  const seenInGroup: Set<string>[] = [new Set<string>()];
  let hasMisplacedDomItems = false;

  for (const elChild of [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer, :scope > ytd-rich-section-renderer")]) {
    if (elChild.tagName === "YTD-RICH-SECTION-RENDERER") {
      domGroupIndex++;
      seenInGroup.push(new Set<string>());
      continue;
    }
    if (elChild.tagName !== "YTD-RICH-ITEM-RENDERER" || !isPolymerElement(elChild)) continue;
    const id = videoIdFromData(elChild.data);
    const groupSeen = seenInGroup[domGroupIndex] ?? new Set<string>();
    seenInGroup[domGroupIndex] = groupSeen;
    const isInModel = !!id && standaloneModelIds.has(id);
    const belongsInGroup = !!id && (modelGroups[domGroupIndex]?.has(id) ?? false);
    const isDuplicate = !!id && groupSeen.has(id);
    if (!isInModel || !belongsInGroup || isDuplicate) {
      elChild.remove();
      if (isInModel && !belongsInGroup) hasMisplacedDomItems = true;
    } else {
      groupSeen.add(id);
    }
  }

  if (hasMisplacedDomItems) {
    elGrid.set("data.contents", deepArray(elGrid.data, "contents").slice());
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
