import { assignItemViewTransitionNames, clearItemViewTransitionNames } from "../animations";
import { deepArray, deepRecord, isPolymerElement, videoIdFromData } from "../helpers";
import { type VideoSnapshot, VideoStatus } from "../types";
import { findRichItemIndex, videoIdFromRichItem } from "./content";
import { findItemElement, findShelfForSection } from "./query";
import { buildRichItem } from "./renderer";
import { updateVideoInDom } from "./update";

export async function repositionVideoInSection(
  freshSnapshot: VideoSnapshot,
  sectionVideos: VideoSnapshot[],
  allSnapshots: Map<string, VideoSnapshot>
) {
  const { videoId, sectionTitle, rawRenderer, status } = freshSnapshot;
  const elShelf = findShelfForSection(sectionTitle);

  if (!elShelf || !isPolymerElement(elShelf)) {
    void updateVideoInDom(videoId, freshSnapshot, true);
    return;
  }

  const shelfContents = deepArray(elShelf.data, "contents");
  const iCurrent = findRichItemIndex(shelfContents, videoId);

  if (iCurrent < 0) {
    void updateVideoInDom(videoId, freshSnapshot, true);
    return;
  }

  const contentsWithoutVideo = shelfContents.filter((_, i) => i !== iCurrent);
  const iInsert = resolveInsertIndex(contentsWithoutVideo, videoId, sectionVideos, status, allSnapshots);

  if (iInsert === iCurrent) {
    void updateVideoInDom(videoId, freshSnapshot, true);
    return;
  }

  const newContents = [...contentsWithoutVideo];
  newContents.splice(iInsert, 0, buildRichItem(rawRenderer));

  const elItems = elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer");
  assignItemViewTransitionNames(elItems);

  try {
    await document.startViewTransition(() => {
      elShelf.set("data.contents", newContents);
      const elMovedItem = findItemElement(videoId);
      if (elMovedItem) {
        elMovedItem.style.viewTransitionName = `ytsua-item-${videoId}`;
      }
    }).finished;
  } finally {
    clearItemViewTransitionNames(elItems);
    const elMovedItem = findItemElement(videoId);
    if (elMovedItem) {
      elMovedItem.style.viewTransitionName = "";
    }
  }
}

function resolveInsertIndex(
  contentsWithoutVideo: unknown[],
  videoId: string,
  sectionVideos: VideoSnapshot[],
  status: VideoStatus,
  allSnapshots: Map<string, VideoSnapshot>
) {
  const sectionVideoIds = sectionVideos.map(video => video.videoId);
  const videoApiRank = sectionVideoIds.indexOf(videoId);

  let iInsert = contentsWithoutVideo.length;
  for (let i = 0; i < contentsWithoutVideo.length; i++) {
    const itemVideoId = videoIdFromData(deepRecord(contentsWithoutVideo[i], "richItemRenderer")) ?? "";
    const itemApiRank = sectionVideoIds.indexOf(itemVideoId);
    if (itemApiRank >= 0 && itemApiRank > videoApiRank) {
      iInsert = i;
      break;
    }
  }

  if (status === VideoStatus.Live) {
    return iInsert;
  }

  let leadingLiveVideoCount = 0;
  for (const item of contentsWithoutVideo) {
    const itemVideoId = videoIdFromRichItem(item) ?? "";
    const itemSnapshot = allSnapshots.get(itemVideoId);
    if (itemSnapshot?.status !== VideoStatus.Live) {
      break;
    }
    leadingLiveVideoCount++;
  }
  return Math.max(iInsert, leadingLiveVideoCount);
}
