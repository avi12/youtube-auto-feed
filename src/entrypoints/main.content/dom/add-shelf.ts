import {
  assignItemViewTransitionNames,
  clearItemViewTransitionNames,
  triggerAnimation
} from "../animations";
import { deepArray, isPolymerElement, isRecord, videoIdFromData } from "../helpers";
import { type VideoSnapshot, VideoStatus } from "../types";
import { addSectionToDom } from "./add-section";
import { findItemElement, findShelfForSection, leadingLiveCount } from "./query";
import { buildRichItem } from "./renderer";

export async function addVideoToDom(freshSnapshot: VideoSnapshot, allFreshSnapshots: VideoSnapshot[], snapshot: Map<string, VideoSnapshot>) {
  const {
    sectionTitle,
    videoId,
    rawRenderer,
    status
  } = freshSnapshot;
  const sectionVideos = allFreshSnapshots.filter(video => video.sectionTitle === sectionTitle);
  const elShelf = findShelfForSection(sectionTitle);

  if (!elShelf || !isPolymerElement(elShelf)) {
    await addSectionToDom(sectionTitle, sectionVideos);
    return;
  }

  const iApiInsert = Math.max(0, sectionVideos.findIndex(video => video.videoId === videoId));
  const iInsert = status !== VideoStatus.Live
    ? Math.max(iApiInsert, leadingLiveCount(elShelf, snapshot))
    : iApiInsert;
  const elExistingItems = elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer");
  assignItemViewTransitionNames(elExistingItems);

  const shelfContents = deepArray(elShelf.data, "contents");
  const newShelfContents = [...shelfContents];
  newShelfContents.splice(iInsert, 0, buildRichItem(rawRenderer));

  const isCollapsed = isRecord(elShelf.data) && elShelf.data.isExpanded === false;
  const elOverflowStyle = isCollapsed
    ? buildCollapsedOverflowStyle(elExistingItems, iInsert)
    : null;
  if (elOverflowStyle) {
    document.head.append(elOverflowStyle);
  }

  const wasExpanded = isRecord(elShelf.data) ? elShelf.data.isExpanded : undefined;

  const transition = document.startViewTransition(() => {
    elShelf.set("data.contents", newShelfContents);
    if (wasExpanded === false) {
      elShelf.set("data.isExpanded", false);
    }
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
    elOverflowStyle?.remove();
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
  const transitionName = `ytsua-item-${overflowVideoId}`;
  const elStyle = document.createElement("style");
  elStyle.textContent =
    `::view-transition-old(${transitionName}){animation:ytsua-shelf-overflow-exit 380ms cubic-bezier(0.4,0,0.2,1) forwards;--ytsua-overflow-translate:${translateX}px ${translateY}px}` +
    `::view-transition-new(${transitionName}){animation:none;opacity:0}`;
  return elStyle;
}
