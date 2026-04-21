import { assignItemViewTransitionNames, buildShiftTransitionStyle, clearAllItemViewTransitionNames } from "../animations";
import { deepArray, deepRecord, isPolymerElement, videoIdFromData } from "../helpers";
import { type VideoSnapshot, VideoStatus } from "../types";
import { findRichItemIndex, videoIdFromRichItem } from "./rich-item";
import { findItemElement, findShelfForSection } from "./query";
import { buildRichItem } from "./build";
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

  clearAllItemViewTransitionNames();

  const elItems = elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer");
  assignItemViewTransitionNames(elItems);

  const animateIds = new Set(
    [...elItems]
      .filter(isPolymerElement)
      .map(el => videoIdFromData(el.data))
      .filter((id): id is string => id !== null && id !== "")
  );

  const elShiftStyle = buildShiftTransitionStyle(elItems);
  document.head.append(elShiftStyle);

  try {
    await document.startViewTransition(() => {
      elShelf.set("data.contents", newContents);
      for (const elItem of elItems) {
        elItem.style.viewTransitionName = "";
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
    }).finished;
  } finally {
    clearAllItemViewTransitionNames();
    elShiftStyle.remove();
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
