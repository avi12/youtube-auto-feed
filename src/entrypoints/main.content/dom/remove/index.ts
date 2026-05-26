import { isVideoRenderer } from "../../api/guards";
import { isPolymerElement, videoIdFromData } from "../../helpers";
import type { Prettify } from "../../types";
import { removeGridItems } from "./grid";
import { removeInnerShelfItems, removeRichShelfItems } from "./shelf";

type ItemContainer = "richShelf" | "innerShelf" | "grid";

export interface ItemInfo {
  videoId: string;
  elItem: HTMLElement;
  isOffScreen: boolean;
  container: ItemContainer;
  elRichShelf: HTMLElement | null;
  elInnerShelf: HTMLElement | null;
}

export async function removeVideosFromDom({ videoIds, shelfProtectedIds = new Set<string>() }: {
  videoIds: string[];
  shelfProtectedIds?: Set<string>;
}) {
  const videoIdSet = new Set(videoIds);
  const items = collectItems({
    videoIdSet,
    shelfProtectedIds
  });

  // Off-screen shelf items skip animation since their teardown isn't visible.
  for (const { container, isOffScreen, elItem } of items) {
    const isInvisibleShelfItem = isOffScreen && container !== "grid";
    if (isInvisibleShelfItem) {
      elItem.remove();
    }
  }

  await removeRichShelfItems(items);
  await removeInnerShelfItems(items);
  await removeGridItems({
    items,
    allRequestedVideoIds: videoIds
  });
}

function collectItems({ videoIdSet, shelfProtectedIds }: {
  videoIdSet: Set<string>;
  shelfProtectedIds: Set<string>;
}) {
  const items: Prettify<ItemInfo>[] = [];

  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (!videoId || !videoIdSet.has(videoId)) {
      continue;
    }

    const isItemHidden = elItem.offsetWidth === 0 && elItem.offsetHeight === 0;
    const { top, bottom } = elItem.getBoundingClientRect();
    const isOffScreen = isItemHidden || top > innerHeight || bottom < 0;
    const elRichShelf = elItem.closest<HTMLElement>("ytd-rich-shelf-renderer");
    const elInnerShelf = elRichShelf ? null : elItem.closest<HTMLElement>("ytd-shelf-renderer");
    if (elRichShelf && isPolymerElement(elRichShelf)) {
      if (!shelfProtectedIds.has(videoId)) {
        items.push({
          videoId,
          elItem,
          isOffScreen,
          container: "richShelf",
          elRichShelf,
          elInnerShelf: null
        });
      }
    } else if (elInnerShelf && isPolymerElement(elInnerShelf)) {
      items.push({
        videoId,
        elItem,
        isOffScreen,
        container: "innerShelf",
        elRichShelf: null,
        elInnerShelf
      });
    } else {
      items.push({
        videoId,
        elItem,
        isOffScreen,
        container: "grid",
        elRichShelf: null,
        elInnerShelf: null
      });
    }
  }

  for (const elGridVideo of document.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
    if (!isPolymerElement(elGridVideo)) {
      continue;
    }

    const { data } = elGridVideo;
    const videoId = isVideoRenderer(data) ? data.videoId : "";
    if (!videoId || !videoIdSet.has(videoId)) {
      continue;
    }

    const { top: gridVideoTop, bottom: gridVideoBottom } = elGridVideo.getBoundingClientRect();
    const isOffScreen = gridVideoTop > innerHeight || gridVideoBottom < 0;
    const elInnerShelf = elGridVideo.closest<HTMLElement>("ytd-shelf-renderer");
    if (elInnerShelf && isPolymerElement(elInnerShelf)) {
      items.push({
        videoId,
        elItem: elGridVideo,
        isOffScreen,
        container: "innerShelf",
        elRichShelf: null,
        elInnerShelf
      });
    }
  }

  return items;
}
