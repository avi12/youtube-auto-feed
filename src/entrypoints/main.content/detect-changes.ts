import { parseSecondsAgo } from "./api/guards";
import { addVideosToGridDom, cleanOrphanedGridItems } from "./dom/add-grid";
import { addVideosToDom } from "./dom/add-shelf";
import { moveVideosToFront } from "./dom/move";
import { findShelfForSection } from "./dom/query";
import { removeVideosFromDom } from "./dom/remove";
import { repositionVideoInSection } from "./dom/reposition";
import { updateVideoInDom } from "./dom/update";
import {
  deepArray, deepRecord, deepString, isPolymerElement, isRecord, videoIdFromData 
} from "./helpers";
import { type VideoSnapshot, VideoStatus } from "./types";

function readCurrentVideoIds() {
  const videoIds = new Set<string>();

  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (videoId) {
      videoIds.add(videoId);
    }
  }

  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data)) {
    for (const item of deepArray(elGrid.data, "contents")) {
      const videoId = videoIdFromData(deepRecord(item, "richItemRenderer"));
      if (videoId) {
        videoIds.add(videoId);
        continue;
      }

      for (const shelfItem of deepArray(item, "richSectionRenderer", "content", "richShelfRenderer", "contents")) {
        const shelfVideoId = videoIdFromData(deepRecord(shelfItem, "richItemRenderer"));
        if (shelfVideoId) {
          videoIds.add(shelfVideoId);
        }
      }
      for (const listItem of [
        ...deepArray(item, "richSectionRenderer", "content", "shelfRenderer", "content", "horizontalListRenderer", "items"),
        ...deepArray(item, "richSectionRenderer", "content", "shelfRenderer", "content", "gridRenderer", "items")
      ]) {
        const listVideoId = deepString(listItem, "videoRenderer", "videoId") || deepString(listItem, "gridVideoRenderer", "videoId");
        if (listVideoId) {
          videoIds.add(listVideoId);
        }
      }
    }
  }

  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    const shelfContent = deepRecord(elShelf.data, "content");
    for (const listItem of [
      ...deepArray(shelfContent, "horizontalListRenderer", "items"),
      ...deepArray(shelfContent, "gridRenderer", "items")
    ]) {
      const listVideoId = deepString(listItem, "videoRenderer", "videoId") || deepString(listItem, "gridVideoRenderer", "videoId");
      if (listVideoId) {
        videoIds.add(listVideoId);
      }
    }
  }

  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    for (const item of deepArray(elShelf.data, "contents")) {
      const videoId = videoIdFromData(deepRecord(item, "richItemRenderer"));
      if (videoId) {
        videoIds.add(videoId);
      }
    }
  }

  return videoIds;
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

  const currentVideoIds = readCurrentVideoIds();

  const videosToAdd: VideoSnapshot[] = [];
  const videosToReposition: VideoSnapshot[] = [];
  const videosToMoveToFront: VideoSnapshot[] = [];
  for (const [videoId, fresh] of freshMap) {
    if (!currentVideoIds.has(videoId)) {
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
    } else if (previous.sectionTitle && fresh.sectionTitle && previous.sectionTitle !== fresh.sectionTitle) {
      videoIdsToRemove.push(videoId);
      videosToAdd.push(fresh);
    } else {
      const isTitleChanged = previous.title !== fresh.title;
      const isThumbnailChanged = previous.thumbnailUrl !== fresh.thumbnailUrl;
      const isStatusChanged = previous.status !== fresh.status;
      const isViewCountChanged = previous.viewCountText !== fresh.viewCountText;
      const isTimestampChanged = previous.publishedTimeText !== fresh.publishedTimeText;
      const isChannelLiveChanged = previous.isChannelLive !== fresh.isChannelLive;
      const isVisualChange = isTitleChanged || isThumbnailChanged || isStatusChanged;
      const isAnyChange = isVisualChange || isViewCountChanged || isTimestampChanged || isChannelLiveChanged;
      if (isAnyChange) {
        void updateVideoInDom(videoId, fresh, isVisualChange);
      }
    }
  }

  // Classify adds before removes run so shelf membership reflects the API state,
  // not the post-remove DOM state (a remove may empty and tear down a shelf section).
  const timeOrderedSnapshots = freshSnapshots.toSorted(
    (videoA, videoB) => parseSecondsAgo(videoA.publishedTimeText) - parseSecondsAgo(videoB.publishedTimeText)
  );
  const shelfVideos = videosToAdd.filter(video => !!findShelfForSection(video.sectionTitle));
  const gridVideos = videosToAdd.filter(video => !findShelfForSection(video.sectionTitle));

  const isLayoutChange = videoIdsToRemove.length > 0 || videosToAdd.length > 0 || videosToReposition.length > 0;

  if (videoIdsToRemove.length > 0) {
    await removeVideosFromDom(videoIdsToRemove);
  }

  for (const video of videosToReposition) {
    const sectionVideos = freshSnapshots.filter(snapshot => snapshot.sectionTitle === video.sectionTitle);
    await repositionVideoInSection(video, sectionVideos, freshMap);
  }

  if (shelfVideos.length > 0) {
    await addVideosToDom(shelfVideos, timeOrderedSnapshots, freshMap);
  }

  if (gridVideos.length > 0) {
    await addVideosToGridDom(gridVideos, timeOrderedSnapshots);
  }

  if (videosToMoveToFront.length > 0) {
    await moveVideosToFront(videosToMoveToFront, freshSnapshots);
  }

  cleanOrphanedGridItems();

  const postChangeVideoIds = readCurrentVideoIds();
  for (const videoId of videoIdsToRemove) {
    const staleVideo = previousSnapshot.get(videoId);
    if (staleVideo && postChangeVideoIds.has(videoId)) {
      freshMap.set(videoId, staleVideo);
    }
  }

  return { isLayoutChange, snapshot: freshMap };
}
