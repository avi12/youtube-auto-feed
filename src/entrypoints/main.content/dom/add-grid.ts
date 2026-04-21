import {
  assignItemViewTransitionNames,
  buildNewItemTransitionStyle,
  buildShiftTransitionStyle,
  clearAllItemViewTransitionNames,
  clearItemViewTransitionNames
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
  const standaloneVideos = sortedVideos.filter(video => !video.sectionTitle);

  let actuallyAddedVideos: VideoSnapshot[] = [];
  let elNewItemTransitionStyle: HTMLStyleElement | null = null;

  clearAllItemViewTransitionNames();

  const elAllItems = [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")];
  const { elElementsToAnimate, elSectionsToAnimate } = standaloneVideos.length > 0
    ? collectGridShiftTargets(elGridContents, elAllItems, standaloneVideos, freshOrderMap)
    : { elElementsToAnimate: [] as HTMLElement[], elSectionsToAnimate: [] as HTMLElement[] };

  assignItemViewTransitionNames(elElementsToAnimate);
  const shiftCount = elElementsToAnimate.length;
  const shiftDelayPerItemMs = shiftCount > 1 ? Math.min(80 / (shiftCount - 1), 20) : 0;
  const elShiftStyle = buildShiftTransitionStyle(elElementsToAnimate, new Set(), shiftDelayPerItemMs);
  document.head.append(elShiftStyle);

  const animateIds = new Set(
    elElementsToAnimate
      .filter(isPolymerElement)
      .map(el => videoIdFromData(el.data))
      .filter((id): id is string => id !== null && id !== "")
  );

  try {
    await document.startViewTransition(async () => {
      const presentIds = readGridVideoIds(elGrid, elGridContents);
      const videosToInsert = sortedVideos.filter(video => !presentIds.has(video.videoId));
      if (videosToInsert.length === 0) {
        return;
      }

      const newContents = [...deepArray(elGrid.data, "contents")];

      const findExistingSectionIndex = (sectionTitle: string) => sectionTitle ? newContents.findIndex(item =>
        deepString(item, "richSectionRenderer", "content", "richShelfRenderer", "title", "runs", "0", "text") === sectionTitle ||
        deepString(item, "richSectionRenderer", "content", "shelfRenderer", "title", "runs", "0", "text") === sectionTitle
      ) : -1;

      // Group videos that need a brand-new section created
      const newSectionGroups = new Map<string, VideoSnapshot[]>();
      const videosForNormalPath: VideoSnapshot[] = [];
      for (const video of videosToInsert) {
        if (video.sectionTitle && findExistingSectionIndex(video.sectionTitle) < 0) {
          const group = newSectionGroups.get(video.sectionTitle) ?? [];
          group.push(video);
          newSectionGroups.set(video.sectionTitle, group);
        } else {
          videosForNormalPath.push(video);
        }
      }

      // Insert new sections at the position determined by fresh order
      for (const [sectionTitle, sectionVideos] of newSectionGroups) {
        const sectionMinFreshIndex = sectionVideos.reduce(
          (min, v) => Math.min(min, freshOrderMap.get(v.videoId) ?? Infinity),
          Infinity
        );
        const iInsert = findSectionInsertIndex(newContents, sectionMinFreshIndex, freshOrderMap);
        newContents.splice(iInsert, 0, buildNewRichSection(sectionTitle, sectionVideos));
      }

      // Add videos to existing sections or as standalone items
      for (const video of videosForNormalPath) {
        const { videoId, rawRenderer, sectionTitle } = video;
        const iSection = findExistingSectionIndex(sectionTitle);

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

      for (const elItem of elElementsToAnimate) {
        if (elItem.tagName === "YTD-RICH-ITEM-RENDERER") {
          elItem.style.viewTransitionName = "";
        }
      }

      for (let i = 0; i < 10 && actuallyAddedVideos.some(video => !findItemElement(video.videoId)); i++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }

      const reassignedIds = new Set<string>();
      for (const elItem of elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")) {
        if (!isPolymerElement(elItem)) continue;
        const id = videoIdFromData(elItem.data);
        if (id && animateIds.has(id) && !reassignedIds.has(id)) {
          reassignedIds.add(id);
          elItem.style.viewTransitionName = `ytsua-item-${id}`;
        }
      }

      const elNewItems: HTMLElement[] = [];
      for (const video of actuallyAddedVideos) {
        const elNewItem = findItemElement(video.videoId);
        if (elNewItem) {
          elNewItem.style.viewTransitionName = `ytsua-item-${video.videoId}`;
          elNewItems.push(elNewItem);
        }
      }
      if (elNewItems.length > 0) {
        elNewItemTransitionStyle = buildNewItemTransitionStyle(elNewItems);
        document.head.append(elNewItemTransitionStyle);
      }
    }).finished;
  } finally {
    elShiftStyle.remove();
    elNewItemTransitionStyle?.remove();
    clearItemViewTransitionNames(elElementsToAnimate);
    clearItemViewTransitionNames(elSectionsToAnimate);
    for (const video of actuallyAddedVideos) {
      const elNewItem = findItemElement(video.videoId);
      if (elNewItem) elNewItem.style.viewTransitionName = "";
    }
    clearAllItemViewTransitionNames();
  }

  for (const elSection of document.querySelectorAll<HTMLElement>("ytd-rich-section-renderer.ytsua-section-removing")) {
    elSection.classList.remove("ytsua-section-removing");
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

  const seenDomIds = new Set<string>();
  for (const elChild of [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer, :scope > ytd-rich-section-renderer")]) {
    if (elChild.tagName !== "YTD-RICH-ITEM-RENDERER" || !isPolymerElement(elChild)) continue;
    const id = videoIdFromData(elChild.data);
    const isInModel = !!id && standaloneModelIds.has(id);
    const isDuplicate = !!id && seenDomIds.has(id);
    if (!isInModel || isDuplicate) {
      elChild.remove();
    } else {
      seenDomIds.add(id);
    }
  }

}

function findSectionInsertIndex(contents: unknown[], sectionMinFreshIndex: number, freshOrderMap: Map<string, number>) {
  for (let iContent = 0; iContent < contents.length; iContent++) {
    const item = contents[iContent];
    const standaloneId = videoIdFromRichItem(item);
    if (standaloneId) {
      if ((freshOrderMap.get(standaloneId) ?? Infinity) > sectionMinFreshIndex) return iContent;
      continue;
    }
    const existingSectionItems = deepArray(item, "richSectionRenderer", "content", "richShelfRenderer", "contents");
    if (existingSectionItems.length > 0) {
      const existingSectionMin = existingSectionItems.reduce((min, contentItem) => {
        const id = videoIdFromRichItem(contentItem);
        return Math.min(min, id ? (freshOrderMap.get(id) ?? Infinity) : Infinity);
      }, Infinity);
      if (existingSectionMin > sectionMinFreshIndex) return iContent;
    }
  }
  return contents.length;
}

function buildNewRichSection(sectionTitle: string, videos: VideoSnapshot[]) {
  return {
    richSectionRenderer: {
      content: {
        richShelfRenderer: {
          title: { runs: [{ text: sectionTitle }] },
          contents: videos.map(({ rawRenderer }) => buildRichItem(rawRenderer)),
          trackingParams: ""
        }
      },
      trackingParams: ""
    }
  };
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
