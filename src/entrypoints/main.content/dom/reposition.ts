import { deepArray, deepRecord, isPolymerElement, videoIdFromData } from "../helpers";
import { type VideoSnapshot, VideoStatus } from "../types";
import {
  assignItemViewTransitionNames,
  buildShiftTransitionStyle,
  clearAllItemViewTransitionNames,
  extractAnimateIds,
  filterToViewport,
  prefersReducedMotion,
  reassignTransitionNames
} from "./animations";
import { buildRichItem } from "./build";
import { findShelfForSection } from "./query";
import { findRichItemIndex, videoIdFromRichItem } from "./rich-item";
import { updateVideoInDom } from "./update";

export async function repositionVideoInSection({
  freshSnapshot,
  sectionVideos,
  allSnapshots
}: {
  freshSnapshot: VideoSnapshot;
  sectionVideos: VideoSnapshot[];
  allSnapshots: Map<string, VideoSnapshot>;
}) {
  const {
    videoId, sectionTitle, rawRenderer, status
  } = freshSnapshot;
  const elShelf = findShelfForSection(sectionTitle);
  if (!elShelf || !isPolymerElement(elShelf)) {
    updateVideoInDom(videoId, freshSnapshot);
    return;
  }

  const shelfContents = deepArray(elShelf.data, "contents");
  const iCurrent = findRichItemIndex({ contents: shelfContents, videoId });
  if (iCurrent < 0) {
    updateVideoInDom(videoId, freshSnapshot);
    return;
  }

  const contentsWithoutVideo = shelfContents.filter((_, i) => i !== iCurrent);
  const iInsert = resolveInsertIndex({ contentsWithoutVideo, videoId, sectionVideos, status, allSnapshots });
  if (iInsert === iCurrent) {
    updateVideoInDom(videoId, freshSnapshot);
    return;
  }

  const newContents = [...contentsWithoutVideo];
  newContents.splice(iInsert, 0, buildRichItem(rawRenderer));

  if (prefersReducedMotion()) {
    elShelf.set("data.contents", newContents);
    updateVideoInDom(videoId, freshSnapshot);
    return;
  }

  clearAllItemViewTransitionNames();

  const elItems = filterToViewport(elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer"));
  assignItemViewTransitionNames(elItems);

  const animateIds = extractAnimateIds(elItems);

  const elShiftStyle = buildShiftTransitionStyle({ elItems });
  document.head.append(elShiftStyle);

  try {
    await document.startViewTransition(() => {
      elShelf.set("data.contents", newContents);
      for (const elItem of elItems) {
        elItem.style.viewTransitionName = "";
      }
      reassignTransitionNames({ elItems: elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer"), animateIds });
    }).finished;
  } finally {
    clearAllItemViewTransitionNames();
    elShiftStyle.remove();
  }
}

function resolveInsertIndex({
  contentsWithoutVideo,
  videoId,
  sectionVideos,
  status,
  allSnapshots
}: {
  contentsWithoutVideo: unknown[];
  videoId: string;
  sectionVideos: VideoSnapshot[];
  status: VideoStatus;
  allSnapshots: Map<string, VideoSnapshot>;
}) {
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
