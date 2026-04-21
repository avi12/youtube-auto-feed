import {
  assignItemViewTransitionNames,
  buildNewItemTransitionStyle,
  buildShiftTransitionStyle,
  clearAllItemViewTransitionNames,
  clearItemViewTransitionNames
} from "../animations";
import { deepArray, isPolymerElement, isRecord, videoIdFromData } from "../helpers";
import { type VideoSnapshot, VideoStatus } from "../types";
import { addSectionToDom } from "./add-section";
import { findItemElement, findShelfForSection, leadingLiveCount } from "./query";
import { videoIdFromRichItem } from "./rich-item";
import { buildRichItem } from "./build";

export async function addVideosToDom(freshSnapshots: VideoSnapshot[], allFreshSnapshots: VideoSnapshot[], snapshot: Map<string, VideoSnapshot>) {
  const bySection = new Map<string, VideoSnapshot[]>();
  for (const video of freshSnapshots) {
    const sectionGroup = bySection.get(video.sectionTitle) ?? [];
    sectionGroup.push(video);
    bySection.set(video.sectionTitle, sectionGroup);
  }
  for (const [, sectionVideos] of bySection) {
    await addVideosToSection(sectionVideos, allFreshSnapshots, snapshot);
  }
}

async function addVideosToSection(videos: VideoSnapshot[], allFreshSnapshots: VideoSnapshot[], snapshot: Map<string, VideoSnapshot>) {
  const { sectionTitle } = videos[0];
  const sectionVideos = allFreshSnapshots.filter(video => video.sectionTitle === sectionTitle);
  const elShelf = findShelfForSection(sectionTitle);

  if (!elShelf || !isPolymerElement(elShelf)) {
    await addSectionToDom(sectionTitle, sectionVideos);
    return;
  }

  const shelfContents = deepArray(elShelf.data, "contents");
  const videosToInsert = videos.filter(video => !shelfContents.some(item => videoIdFromRichItem(item) === video.videoId));
  if (videosToInsert.length === 0) {
    return;
  }

  clearAllItemViewTransitionNames();

  const elExistingItems = elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer");
  assignItemViewTransitionNames(elExistingItems);

  const animateIds = new Set(
    [...elExistingItems]
      .filter(isPolymerElement)
      .map(el => videoIdFromData(el.data))
      .filter((id): id is string => id !== null && id !== "")
  );

  // Sort descending by insert index so each splice doesn't offset the next
  const insertOps = videosToInsert
    .map(video => {
      const iApiInsert = Math.max(0, sectionVideos.findIndex(v => v.videoId === video.videoId));
      const iInsert = video.status !== VideoStatus.Live
        ? Math.max(iApiInsert, leadingLiveCount(elShelf, snapshot))
        : iApiInsert;
      return { video, iInsert };
    })
    .sort((a, b) => b.iInsert - a.iInsert);

  const newShelfContents = [...shelfContents];
  for (const { video, iInsert } of insertOps) {
    newShelfContents.splice(iInsert, 0, buildRichItem(video.rawRenderer));
  }

  const isCollapsed = isRecord(elShelf.data) && elShelf.data.isExpanded === false;
  const iMinInsert = insertOps[insertOps.length - 1].iInsert;
  const overflowResult = isCollapsed ? buildCollapsedOverflowStyle(elExistingItems, iMinInsert) : null;
  if (overflowResult) {
    document.head.append(overflowResult.elStyle);
  }

  const excludeNames = overflowResult ? new Set([overflowResult.overflowName]) : new Set<string>();
  const elShiftStyle = buildShiftTransitionStyle(elExistingItems, excludeNames);
  document.head.append(elShiftStyle);

  const wasExpanded = isRecord(elShelf.data) ? elShelf.data.isExpanded : undefined;
  let elNewItemTransitionStyle: HTMLStyleElement | null = null;

  const transition = document.startViewTransition(async () => {
    elShelf.set("data.contents", newShelfContents);
    if (wasExpanded === false) {
      elShelf.set("data.isExpanded", false);
    }
    for (const elItem of elExistingItems) {
      elItem.style.viewTransitionName = "";
    }

    for (let i = 0; i < 10 && videosToInsert.some(video => !findItemElement(video.videoId)); i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }

    const reassignedIds = new Set<string>();
    for (const elItem of elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
      if (!isPolymerElement(elItem)) continue;
      const id = videoIdFromData(elItem.data);
      if (id && animateIds.has(id) && !reassignedIds.has(id)) {
        reassignedIds.add(id);
        elItem.style.viewTransitionName = `ytsua-item-${id}`;
      }
    }

    const insertedAscending = insertOps.toReversed();
    const elNewItems: HTMLElement[] = [];
    for (const { video } of insertedAscending) {
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
  });

  try {
    await transition.finished;
  } finally {
    clearItemViewTransitionNames(elExistingItems);
    clearAllItemViewTransitionNames();
    overflowResult?.elStyle.remove();
    elShiftStyle.remove();
    elNewItemTransitionStyle?.remove();
    for (const { video } of insertOps) {
      const elNewItem = findItemElement(video.videoId);
      if (elNewItem) elNewItem.style.viewTransitionName = "";
    }
  }
}

function buildCollapsedOverflowStyle(elExistingItems: NodeListOf<HTMLElement>, iInsert: number) {
  const visibleItems = [...elExistingItems].filter(elItem => elItem.offsetWidth > 0);
  const elLastVisible = visibleItems.at(-1);
  if (!elLastVisible || iInsert >= visibleItems.length) {
    return null;
  }

  const overflowVideoId = isPolymerElement(elLastVisible) ? videoIdFromData(elLastVisible.data) : null;
  if (!overflowVideoId) {
    return null;
  }

  const elFirstVisible = visibleItems[0];
  const lastRect = elLastVisible.getBoundingClientRect();
  const firstRect = elFirstVisible?.getBoundingClientRect();
  const translateX = firstRect ? Math.round(firstRect.left - lastRect.left) : -Math.round(lastRect.width);
  const translateY = Math.round(lastRect.height * 0.4);
  const overflowName = `ytsua-item-${overflowVideoId}`;
  const elStyle = document.createElement("style");
  elStyle.textContent =
    `::view-transition-old(${overflowName}){animation:ytsua-shelf-overflow-exit 380ms cubic-bezier(0.4,0,0.2,1) forwards;--ytsua-overflow-translate:${translateX}px ${translateY}px}` +
    `::view-transition-new(${overflowName}){animation:none;opacity:0}`;
  return { elStyle, overflowName };
}
