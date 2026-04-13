import { addVideosToGridDom } from "./dom/add-grid";
import { addVideoToDom } from "./dom/add-shelf";
import { moveVideosToFront } from "./dom/move";
import { findShelfForSection } from "./dom/query";
import { removeVideosFromDom } from "./dom/remove";
import { repositionVideoInSection } from "./dom/reposition";
import { updateVideoInDom } from "./dom/update";
import { deepArray, deepRecord, isPolymerElement, isRecord, videoIdFromData } from "./helpers";
import { parseSecondsAgo } from "./parse";
import { type VideoSnapshot, VideoStatus } from "./types";

function readDomVideoIds() {
  const domIds = new Set<string>();
  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (videoId) {
      domIds.add(videoId);
    }
  }

  if (domIds.size > 0) {
    return domIds;
  }

  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data)) {
    for (const item of deepArray(elGrid.data, "contents")) {
      const videoId = videoIdFromData(deepRecord(item, "richItemRenderer"));
      if (videoId) {
        domIds.add(videoId);
      }
    }
  }

  return domIds;
}

export async function detectAndApplyChanges(
  previousSnapshot: Map<string, VideoSnapshot>,
  freshSnapshots: VideoSnapshot[]
) {
  const freshMap = new Map(freshSnapshots.map(video => [video.videoId, video]));

  const videoIdsToRemove: string[] = [];
  for (const [videoId] of previousSnapshot) {
    if (!freshMap.has(videoId)) {
      videoIdsToRemove.push(videoId);
    }
  }

  if (videoIdsToRemove.length > 0) {
    await removeVideosFromDom(videoIdsToRemove);
  }

  const currentDomIds = readDomVideoIds();

  const videosToAdd: VideoSnapshot[] = [];
  const videosToReposition: VideoSnapshot[] = [];
  const videosToMoveToFront: VideoSnapshot[] = [];
  for (const [videoId, fresh] of freshMap) {
    if (!currentDomIds.has(videoId)) {
      videosToAdd.push(fresh);
      continue;
    }

    const previous = previousSnapshot.get(videoId);
    if (!previous) {
      continue;
    }

    if (previous.status === VideoStatus.Upcoming && fresh.status === VideoStatus.Live) {
      videosToMoveToFront.push(fresh);
    } else if (
      (previous.status === VideoStatus.Live || previous.status === VideoStatus.Upcoming) &&
      fresh.status === VideoStatus.Video
    ) {
      videosToReposition.push(fresh);
    } else {
      const isTitleChanged = previous.title !== fresh.title;
      const isThumbnailChanged = previous.thumbnailUrl !== fresh.thumbnailUrl;
      const isStatusChanged = previous.status !== fresh.status;
      const isViewCountChanged = previous.viewCountText !== fresh.viewCountText;
      const isTimestampChanged = previous.publishedTimeText !== fresh.publishedTimeText;
      const isVisualChange = isTitleChanged || isThumbnailChanged || isStatusChanged;
      const isAnyChange = isVisualChange || isViewCountChanged || isTimestampChanged;
      if (isAnyChange) {
        void updateVideoInDom(videoId, fresh, isVisualChange);
      }
    }
  }

  const isLayoutChange = videoIdsToRemove.length > 0 || videosToAdd.length > 0 || videosToReposition.length > 0;

  const timeOrderedSnapshots = freshSnapshots.toSorted(
    (videoA, videoB) => parseSecondsAgo(videoA.publishedTimeText) - parseSecondsAgo(videoB.publishedTimeText)
  );

  for (const video of videosToReposition) {
    const sectionVideos = freshSnapshots.filter(snapshot => snapshot.sectionTitle === video.sectionTitle);
    await repositionVideoInSection(video, sectionVideos, freshMap);
  }

  const shelfVideos = videosToAdd.filter(video => !!findShelfForSection(video.sectionTitle));
  const gridVideos = videosToAdd.filter(video => !findShelfForSection(video.sectionTitle));
  for (const video of shelfVideos) {
    await addVideoToDom(video, timeOrderedSnapshots, freshMap);
  }
  if (gridVideos.length > 0) {
    await addVideosToGridDom(gridVideos, timeOrderedSnapshots);
  }

  if (videosToMoveToFront.length > 0) {
    await moveVideosToFront(videosToMoveToFront, freshSnapshots);
  }

  return { isLayoutChange, snapshot: freshMap };
}
