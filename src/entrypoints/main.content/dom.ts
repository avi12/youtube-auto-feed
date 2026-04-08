import {
  assignItemViewTransitionNames,
  buildStaggerStyle,
  clearItemViewTransitionNames,
  triggerAnimation
} from "./animations";
import {
  deepArray,
  deepRecord,
  deepString,
  isPolymerElement,
  isRecord,
  videoIdFromData
} from "./helpers";
import {
  isLockupViewModel,
  isShortsLockupViewModel,
  isVideoRenderer,
  parseLockupViewModel,
  parseRenderer,
  parseShortsLockupViewModel
} from "./parse";
import {
  type InnerTubeVideoRenderer,
  type LockupViewModel,
  type ShortsLockupViewModel,
  type VideoSnapshot,
  VideoStatus
} from "./types";

export function findItemElement(videoId: string) {
  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    if (videoIdFromData(elItem.data) === videoId) {
      return elItem;
    }
  }

  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    if (deepString(elItem.data, "videoId") === videoId) {
      return elItem;
    }
  }
  return null;
}

export function findShelfForSection(sectionTitle: string) {
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    if (deepString(elShelf.data, "title", "runs", "0", "text") === sectionTitle) {
      return elShelf;
    }
  }
  return null;
}

export function readDomSnapshot() {
  const snapshot = new Map<string, VideoSnapshot>();

  function addRichItemToSnapshot(elItem: Element, sectionTitle: string) {
    if (!isPolymerElement(elItem)) {
      return;
    }

    const rawRenderer =
      deepRecord(elItem.data, "content", "videoRenderer") ??
      deepRecord(elItem.data, "content", "gridVideoRenderer") ??
      deepRecord(elItem.data, "content", "richGridMediaRenderer", "content", "videoRenderer") ??
      deepRecord(elItem.data, "content", "lockupViewModel") ??
      deepRecord(elItem.data, "content", "shortsLockupViewModel");
    let videoSnapshot = null;
    if (isVideoRenderer(rawRenderer)) {
      videoSnapshot = parseRenderer(rawRenderer, sectionTitle);
    } else if (isLockupViewModel(rawRenderer)) {
      videoSnapshot = parseLockupViewModel(rawRenderer, sectionTitle);
    } else if (isShortsLockupViewModel(rawRenderer)) {
      videoSnapshot = parseShortsLockupViewModel(rawRenderer, sectionTitle);
    }

    if (videoSnapshot && !snapshot.has(videoSnapshot.videoId)) {
      snapshot.set(videoSnapshot.videoId, videoSnapshot);
    }
  }

  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    const sectionTitle = deepString(elShelf.data, "title", "runs", "0", "text");
    for (const elItem of elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
      addRichItemToSnapshot(elItem, sectionTitle);
    }
  }

  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    const sectionTitle = deepString(elShelf.data, "title", "runs", "0", "text");
    for (const elItem of elShelf.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
      if (!isPolymerElement(elItem)) {
        continue;
      }

      const rawRenderer = elItem.data;
      if (!isVideoRenderer(rawRenderer)) {
        continue;
      }

      const videoSnapshot = parseRenderer(rawRenderer, sectionTitle);
      if (videoSnapshot && !snapshot.has(videoSnapshot.videoId)) {
        snapshot.set(videoSnapshot.videoId, videoSnapshot);
      }
    }
  }

  const elGridContents = document.querySelector("ytd-rich-grid-renderer > #contents");
  if (elGridContents) {
    let currentSectionTitle = "";
    for (const elChild of elGridContents.children) {
      if (elChild.tagName === "YTD-RICH-SECTION-RENDERER") {
        currentSectionTitle = "";
      } else if (elChild.tagName === "YTD-RICH-ITEM-RENDERER") {
        addRichItemToSnapshot(elChild, currentSectionTitle);
      }
    }
  }

  if (snapshot.size === 0) {
    for (const elGridVideo of document.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
      if (!isPolymerElement(elGridVideo)) {
        continue;
      }

      const gridVideoData = elGridVideo.data;
      if (!isVideoRenderer(gridVideoData)) {
        continue;
      }

      const videoSnapshot = parseRenderer(gridVideoData, "");
      if (videoSnapshot) {
        snapshot.set(videoSnapshot.videoId, videoSnapshot);
      }
    }
  }

  return snapshot;
}

export function buildRichItem(rawRenderer: InnerTubeVideoRenderer | LockupViewModel | ShortsLockupViewModel) {
  let content;
  if (isLockupViewModel(rawRenderer)) {
    content = { lockupViewModel: rawRenderer };
  } else if (isShortsLockupViewModel(rawRenderer)) {
    content = { shortsLockupViewModel: rawRenderer };
  } else {
    content = { videoRenderer: rawRenderer };
  }

  return { richItemRenderer: { content, trackingParams: "" } };
}

export function updateLockupMetadata(elParent: HTMLElement, viewCountText: string, publishedTimeText: string) {
  const elMetadataContent = elParent.querySelector("yt-content-metadata-view-model");
  if (!elMetadataContent) {
    return;
  }

  const elMetaTextSpans = elMetadataContent.querySelectorAll<HTMLElement>(".yt-content-metadata-view-model__metadata-text:not(:has(*))");

  for (let iSpan = 0; iSpan < elMetaTextSpans.length; iSpan++) {
    if (elMetaTextSpans[iSpan].textContent?.toLowerCase().includes(" view")) {
      elMetaTextSpans[iSpan].textContent = viewCountText;
      const elTimestampSpan = elMetaTextSpans[iSpan + 1];
      if (elTimestampSpan) {
        elTimestampSpan.textContent = publishedTimeText;
      }

      return;
    }
  }
}

export async function updateVideoInDom(videoId: string, freshSnapshot: VideoSnapshot, isVisualChange: boolean) {
  const elItem = findItemElement(videoId);
  if (!elItem || !isPolymerElement(elItem)) {
    return;
  }

  const elPolymerItem = elItem;
  const { rawRenderer } = freshSnapshot;

  function applyUpdate() {
    const itemData = elPolymerItem.data;
    if (!isRecord(itemData)) {
      return;
    }

    const { content } = itemData;
    if (!isRecord(content)) {
      elPolymerItem.set("data", rawRenderer);
    } else if (isRecord(content.lockupViewModel)) {
      elPolymerItem.set("data.content.lockupViewModel", rawRenderer);
      updateLockupMetadata(elPolymerItem, freshSnapshot.viewCountText, freshSnapshot.publishedTimeText);
    } else if (isRecord(content.videoRenderer)) {
      elPolymerItem.set("data.content.videoRenderer", rawRenderer);
    } else if (isRecord(content.gridVideoRenderer)) {
      elPolymerItem.set("data.content.gridVideoRenderer", rawRenderer);
    } else {
      const richGridMedia = deepRecord(content, "richGridMediaRenderer");
      if (richGridMedia) {
        elPolymerItem.set("data.content.richGridMediaRenderer.content.videoRenderer", rawRenderer);
      }
    }
  }

  if (isVisualChange) {
    elPolymerItem.style.viewTransitionName = `ytsua-item-${videoId}`;
  }

  if (isVisualChange) {
    try {
      await document.startViewTransition(applyUpdate).finished;
    } finally {
      elPolymerItem.style.viewTransitionName = "";
    }
  } else {
    applyUpdate();
  }
}

export function leadingLiveCount(elShelf: Element, snapshot: Map<string, VideoSnapshot>) {
  let count = 0;
  for (const elItem of elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    if (!isPolymerElement(elItem)) {
      break;
    }

    const videoId = videoIdFromData(elItem.data);
    const videoSnapshot = videoId ? snapshot.get(videoId) : null;
    if (videoSnapshot?.status !== VideoStatus.Live) {
      break;
    }

    count++;
  }
  return count;
}

export async function addVideoToDom(freshSnapshot: VideoSnapshot, allFreshSnapshots: VideoSnapshot[], snapshot: Map<string, VideoSnapshot>) {
  const {
    sectionTitle,
    videoId,
    rawRenderer,
    status
  } = freshSnapshot;
  const sectionVideos = allFreshSnapshots.filter(video => video.sectionTitle === sectionTitle);
  const elShelf = findShelfForSection(sectionTitle);

  if (elShelf && isPolymerElement(elShelf)) {
    const iApiInsert = Math.max(0, sectionVideos.findIndex(video => video.videoId === videoId));
    const iInsert = status !== VideoStatus.Live
      ? Math.max(iApiInsert, leadingLiveCount(elShelf, snapshot))
      : iApiInsert;
    const elExistingItems = elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer");
    assignItemViewTransitionNames(elExistingItems);

    const shelfContents = deepArray(elShelf.data, "contents");
    const newShelfContents = [...shelfContents];
    newShelfContents.splice(iInsert, 0, buildRichItem(rawRenderer));

    const transition = document.startViewTransition(() => {
      elShelf.set("data.contents", newShelfContents);
    });

    await transition.ready;
    requestAnimationFrame(() => {
      const elNewItem = findItemElement(videoId);
      if (elNewItem) {
        triggerAnimation(elNewItem, "ytsua-new");
      }
    });

    try {
      await transition.finished;
    } finally {
      clearItemViewTransitionNames(elExistingItems);
    }

    return;
  }

  await addSectionToDom(sectionTitle, sectionVideos);
}

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

  const gridData = elGrid.data;
  if (!isRecord(gridData)) {
    return;
  }

  const freshOrderMap = new Map(allFreshSnapshots.map((video, i) => [video.videoId, i]));

  const sortedVideos = videosToAdd.toSorted(
    (videoA, videoB) => (freshOrderMap.get(videoA.videoId) ?? 0) - (freshOrderMap.get(videoB.videoId) ?? 0)
  );

  // Build the complete new contents array with all insertions at once
  const newContents = [...deepArray(elGrid.data, "contents")];
  for (const { videoId, rawRenderer } of sortedVideos) {
    const freshIndex = freshOrderMap.get(videoId) ?? 0;
    const insertBeforeIndex = newContents.findIndex(contentItem => {
      const richItemData = deepRecord(contentItem, "richItemRenderer");
      if (!richItemData) {
        return false;
      }

      return (freshOrderMap.get(videoIdFromData(richItemData) ?? "") ?? Infinity) > freshIndex;
    });
    const iInsert = insertBeforeIndex >= 0 ? insertBeforeIndex : newContents.length;
    newContents.splice(iInsert, 0, buildRichItem(rawRenderer));
  }

  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  const elAllItems = elGridContents
    ? [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")]
    : [...document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")];

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
  if (firstShiftingItem && elGridContents) {
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
  }

  // Assign names based on current data ("before" screenshot)
  assignItemViewTransitionNames(elAllItems);
  const elStaggerStyle = buildStaggerStyle(elElementsToAnimate);
  document.head.append(elStaggerStyle);

  const transition = document.startViewTransition(() => {
    elGrid.set("data.contents", newContents);
    // Re-assign names based on new data ("after" screenshot).
    // The grid recycles DOM nodes in-place, so each node now shows a different video.
    // View transitions match by name: existing videos animate from old bbox to new bbox.
    assignItemViewTransitionNames(elAllItems);
  });

  try {
    await transition.finished;
  } finally {
    elStaggerStyle.remove();
    clearItemViewTransitionNames(elAllItems);
    clearItemViewTransitionNames(elSectionsToAnimate);
  }

  for (let iNewItem = 0; iNewItem < sortedVideos.length; iNewItem++) {
    const elNewItem = findItemElement(sortedVideos[iNewItem].videoId);
    if (!elNewItem) {
      continue;
    }
    elNewItem.style.setProperty("--ytsua-new-index", String(iNewItem));
    elNewItem.style.setProperty("--ytsua-new-count", String(sortedVideos.length));
    triggerAnimation(elNewItem, "ytsua-new");
  }
}


export async function removeVideosFromDom(videoIds: string[]) {
  type ItemInfo = {
    videoId: string;
    elItem: HTMLElement;
    isOffScreen: boolean;
    container: "richShelf" | "innerShelf" | "grid";
    elRichShelf: HTMLElement | null;
    elInnerShelf: HTMLElement | null;
  };

  const videoIdSet = new Set(videoIds);
  const items: ItemInfo[] = [];

  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (!videoId || !videoIdSet.has(videoId)) {
      continue;
    }

    const isItemHidden = elItem.offsetWidth === 0 && elItem.offsetHeight === 0;
    const isOffScreen = isItemHidden || elItem.getBoundingClientRect().top > innerHeight;
    const elRichShelf = elItem.closest<HTMLElement>("ytd-rich-shelf-renderer");
    const elInnerShelf = elRichShelf ? null : elItem.closest<HTMLElement>("ytd-shelf-renderer");

    if (elRichShelf && isPolymerElement(elRichShelf)) {
      items.push({ videoId, elItem, isOffScreen, container: "richShelf", elRichShelf, elInnerShelf: null });
    } else if (elInnerShelf && isPolymerElement(elInnerShelf)) {
      items.push({ videoId, elItem, isOffScreen, container: "innerShelf", elRichShelf: null, elInnerShelf });
    } else {
      items.push({ videoId, elItem, isOffScreen, container: "grid", elRichShelf: null, elInnerShelf: null });
    }
  }

  for (const elGridVideo of document.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
    if (!isPolymerElement(elGridVideo)) {
      continue;
    }

    const videoId = deepString(elGridVideo.data, "videoId");
    if (!videoId || !videoIdSet.has(videoId)) {
      continue;
    }

    const isOffScreen = elGridVideo.getBoundingClientRect().top > innerHeight;
    const elInnerShelf = elGridVideo.closest<HTMLElement>("ytd-shelf-renderer");
    if (elInnerShelf && isPolymerElement(elInnerShelf)) {
      items.push({ videoId, elItem: elGridVideo, isOffScreen, container: "innerShelf", elRichShelf: null, elInnerShelf });
    }
  }

  for (const { container, isOffScreen, elItem } of items) {
    if (isOffScreen && container !== "grid") {
      elItem.remove();
    }
  }

  const richShelfGroups = new Map<HTMLElement, { videoIds: string[]; elOnScreenItems: HTMLElement[] }>();
  for (const { container, isOffScreen, videoId, elItem, elRichShelf } of items) {
    if (container !== "richShelf" || isOffScreen) {
      continue;
    }

    if (!elRichShelf) {
      continue;
    }

    const group = richShelfGroups.get(elRichShelf) ?? { videoIds: [], elOnScreenItems: [] };
    group.videoIds.push(videoId);
    group.elOnScreenItems.push(elItem);
    richShelfGroups.set(elRichShelf, group);
  }

  for (const [elRichShelf, { videoIds: shelfVideoIds, elOnScreenItems }] of richShelfGroups) {
    if (!isPolymerElement(elRichShelf)) {
      continue;
    }

    const shelfData = elRichShelf.data;
    if (!isRecord(shelfData)) {
      for (const elItem of elOnScreenItems) {
        elItem.remove();
      }
      continue;
    }

    const shelfTitle = deepString(shelfData, "title", "runs", "0", "text");
    const shelfVideoIdSet = new Set(shelfVideoIds);
    const shelfContents = deepArray(shelfData, "contents");
    const filteredShelfContents = shelfContents.filter(
      contentItem => !shelfVideoIdSet.has(videoIdFromData(deepRecord(contentItem, "richItemRenderer")) ?? "")
    );

    const elSiblings = [...elRichShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")].filter(
      elSibling => !elOnScreenItems.includes(elSibling)
    );
    assignItemViewTransitionNames(elSiblings);

    try {
      await document.startViewTransition(() => {
        if (filteredShelfContents.length < shelfContents.length) {
          elRichShelf.set("data.contents", filteredShelfContents);
        } else {
          for (const elItem of elOnScreenItems) {
            elItem.remove();
          }
        }
      }).finished;
    } finally {
      clearItemViewTransitionNames(elSiblings);
    }

    if (filteredShelfContents.length === 0) {
      const elSection = elRichShelf.closest<HTMLElement>("ytd-rich-section-renderer");
      if (elSection) {
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
            if (elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data)) {
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
              if (filteredGridContents.length < currentGridContents.length) {
                elGrid.set("data.contents", filteredGridContents);
                return;
              }
            }
            elSection.remove();
          }).finished;
        } finally {
          elStaggerStyle.remove();
          clearItemViewTransitionNames(elItemsAfterSection);
          clearItemViewTransitionNames(elSectionsAfterSection);
        }
      }
    }
  }

  const innerShelfGroups = new Map<HTMLElement, { videoIds: string[]; elOnScreenItems: HTMLElement[] }>();
  for (const { container, isOffScreen, videoId, elItem, elInnerShelf } of items) {
    if (container !== "innerShelf" || isOffScreen) {
      continue;
    }

    if (!elInnerShelf) {
      continue;
    }

    const group = innerShelfGroups.get(elInnerShelf) ?? { videoIds: [], elOnScreenItems: [] };
    group.videoIds.push(videoId);
    group.elOnScreenItems.push(elItem);
    innerShelfGroups.set(elInnerShelf, group);
  }

  for (const [elInnerShelf, { videoIds: innerShelfVideoIds, elOnScreenItems }] of innerShelfGroups) {
    if (!isPolymerElement(elInnerShelf)) {
      continue;
    }

    const shelfData = elInnerShelf.data;
    if (!isRecord(shelfData)) {
      for (const elItem of elOnScreenItems) {
        elItem.remove();
      }
      continue;
    }

    const { content } = shelfData;
    if (!isRecord(content)) {
      for (const elItem of elOnScreenItems) {
        elItem.remove();
      }
      continue;
    }

    const innerShelfVideoIdSet = new Set(innerShelfVideoIds);
    const isHorizontalList = isRecord(content.horizontalListRenderer);
    const listPath = isHorizontalList ? "data.content.horizontalListRenderer.items" : "data.content.gridRenderer.items";
    const listItems = deepArray(isHorizontalList ? content.horizontalListRenderer : content.gridRenderer, "items");
    const filteredListItems = listItems.filter(
      item => !innerShelfVideoIdSet.has(deepString(item, "videoRenderer", "videoId")) && !innerShelfVideoIdSet.has(deepString(item, "gridVideoRenderer", "videoId"))
    );

    const elSiblings = [...elInnerShelf.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")].filter(
      elSibling => !elOnScreenItems.includes(elSibling)
    );
    assignItemViewTransitionNames(elSiblings);

    try {
      await document.startViewTransition(() => {
        if (filteredListItems.length < listItems.length) {
          elInnerShelf.set(listPath, filteredListItems);
        } else {
          for (const elItem of elOnScreenItems) {
            elItem.remove();
          }
        }
      }).finished;
    } finally {
      clearItemViewTransitionNames(elSiblings);
    }
  }

  const gridItems = items.filter(({ container }) => container === "grid");
  const foundVideoIds = new Set(items.map(({ videoId }) => videoId));

  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data)) {
    const unfoundVideoIds = videoIds.filter(id => !foundVideoIds.has(id));
    if (unfoundVideoIds.length > 0) {
      const unfoundSet = new Set(unfoundVideoIds);
      const currentContents = deepArray(elGrid.data, "contents");
      const filteredContents = currentContents.filter(item => {
        const richItemData = deepRecord(item, "richItemRenderer");
        return !richItemData || !unfoundSet.has(videoIdFromData(richItemData) ?? "");
      });
      if (filteredContents.length < currentContents.length) {
        elGrid.set("data.contents", filteredContents);
      }
    }
  }

  if (gridItems.length === 0) {
    return;
  }

  if (!elGrid || !isPolymerElement(elGrid)) {
    for (const { elItem } of gridItems) {
      elItem.remove();
    }
    return;
  }

  const gridData = elGrid.data;
  if (!isRecord(gridData)) {
    for (const { elItem } of gridItems) {
      elItem.remove();
    }
    return;
  }

  const gridVideoIdSet = new Set(gridItems.map(({ videoId }) => videoId));

  const allGridElements = gridItems.map(({ elItem }) => elItem);
  const onScreenGridElements = gridItems.filter(({ isOffScreen }) => !isOffScreen).map(({ elItem }) => elItem);

  if (onScreenGridElements.length === 0) {
    const currentContents = deepArray(elGrid.data, "contents");
    const filteredContents = currentContents.filter(item => {
      const richItemData = deepRecord(item, "richItemRenderer");
      return !richItemData || !gridVideoIdSet.has(videoIdFromData(richItemData) ?? "");
    });

    if (filteredContents.length < currentContents.length) {
      elGrid.set("data.contents", filteredContents);
    } else {
      for (const elItem of allGridElements) {
        elItem.remove();
      }
    }
    return;
  }

  const removedElSet = new Set(allGridElements);
  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  const elDirectItems: HTMLElement[] = [];
  const elElementsAfterFirstRemoved: HTMLElement[] = [];
  const elSectionsAfterFirstRemoved: HTMLElement[] = [];
  let isAfterFirstRemoved = false;
  let iSection = 0;

  for (const elChild of elGridContents?.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer, :scope > ytd-rich-section-renderer") ?? []) {
    if (removedElSet.has(elChild)) {
      isAfterFirstRemoved = true;
    }

    if (elChild.tagName === "YTD-RICH-ITEM-RENDERER") {
      elDirectItems.push(elChild);
    }

    if (isAfterFirstRemoved && !removedElSet.has(elChild)) {
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
  }

  assignItemViewTransitionNames(elDirectItems);
  const elStaggerStyle = buildStaggerStyle(elElementsAfterFirstRemoved);
  document.head.append(elStaggerStyle);

  const transition = document.startViewTransition(() => {
    const currentContents = deepArray(elGrid.data, "contents");
    const filteredContents = currentContents.filter(item => {
      const richItemData = deepRecord(item, "richItemRenderer");
      return !richItemData || !gridVideoIdSet.has(videoIdFromData(richItemData) ?? "");
    });

    if (filteredContents.length < currentContents.length) {
      elGrid.set("data.contents", filteredContents);
    } else {
      for (const elItem of allGridElements) {
        elItem.remove();
      }
    }
    // Re-assign names based on new data ("after" screenshot).
    assignItemViewTransitionNames(elDirectItems);
  });

  try {
    await transition.finished;
  } finally {
    elStaggerStyle.remove();
    clearItemViewTransitionNames(elDirectItems);
    clearItemViewTransitionNames(elSectionsAfterFirstRemoved);
  }
}

export async function removeVideoFromDom(videoId: string) {
  return removeVideosFromDom([videoId]);
}

export async function addSectionToDom(sectionTitle: string, videos: VideoSnapshot[]) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid)) {
    return;
  }

  if (!isRecord(elGrid.data)) {
    return;
  }

  const newSection = {
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

  const elGridContents = elGrid.querySelector<HTMLElement>("#contents");
  const elAllItems = elGridContents
    ? [...elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")]
    : [...document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")];

  assignItemViewTransitionNames(elAllItems);
  const elStaggerStyle = buildStaggerStyle(elAllItems);
  document.head.append(elStaggerStyle);

  try {
    await document.startViewTransition(() => {
      elGrid.set("data.contents", [newSection, ...deepArray(elGrid.data, "contents")]);
      assignItemViewTransitionNames(elAllItems);
    }).finished;
  } finally {
    elStaggerStyle.remove();
    clearItemViewTransitionNames(elAllItems);
  }
}

export async function moveVideoToFront(videoId: string, freshSnapshot: VideoSnapshot) {
  const { sectionTitle, rawRenderer } = freshSnapshot;
  const elShelf = findShelfForSection(sectionTitle);
  if (!elShelf || !isPolymerElement(elShelf)) {
    void updateVideoInDom(videoId, freshSnapshot, true);
    return;
  }

  const shelfData = elShelf.data;
  if (!isRecord(shelfData)) {
    void updateVideoInDom(videoId, freshSnapshot, true);
    return;
  }

  const contents = deepArray(shelfData, "contents");
  const iCurrent = contents.findIndex(
    contentItem => videoIdFromData(deepRecord(contentItem, "richItemRenderer")) === videoId
  );

  if (iCurrent <= 0) {
    void updateVideoInDom(videoId, freshSnapshot, true);
    return;
  }

  const elItems = elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer");
  assignItemViewTransitionNames(elItems);

  const doMove = () => {
    const shelfContents = deepArray(elShelf.data, "contents");
    const newShelfContents = [...shelfContents];
    newShelfContents.splice(iCurrent, 1);
    newShelfContents.unshift(buildRichItem(rawRenderer));
    elShelf.set("data.contents", newShelfContents);
    const elMovedItem = findItemElement(videoId);
    if (elMovedItem) {
      elMovedItem.style.viewTransitionName = `ytsua-item-${videoId}`;
    }
  };

  try {
    await document.startViewTransition(doMove).finished;
  } finally {
    clearItemViewTransitionNames(elItems);
    const elMovedItem = findItemElement(videoId);
    if (elMovedItem) {
      elMovedItem.style.viewTransitionName = "";
      triggerAnimation(elMovedItem, "ytsua-updated");
    }
  }
}
