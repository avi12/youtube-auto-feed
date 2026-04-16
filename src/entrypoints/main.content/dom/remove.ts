import { deepString, isPolymerElement, videoIdFromData } from "../helpers";
import { removeGridItems } from "./remove-grid";
import { removeInnerShelfItems, removeRichShelfItems } from "./remove-shelf";

export type ItemContainer = "richShelf" | "innerShelf" | "grid";

export interface ItemInfo {
  videoId: string;
  elItem: HTMLElement;
  isOffScreen: boolean;
  container: ItemContainer;
  elRichShelf: HTMLElement | null;
  elInnerShelf: HTMLElement | null;
}

export async function removeVideosFromDom(videoIds: string[]) {
  const videoIdSet = new Set(videoIds);
  const items = collectItems(videoIdSet);

  for (const { container, isOffScreen, elItem } of items) {
    if (isOffScreen && container !== "grid") {
      elItem.remove();
    }
  }

  await removeRichShelfItems(items);
  await removeInnerShelfItems(items);
  await removeGridItems(items, videoIds);
}

function collectItems(videoIdSet: Set<string>): ItemInfo[] {
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

  return items;
}
