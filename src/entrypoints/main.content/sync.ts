import { parseSecondsAgo } from "./api/guards";
import { addVideosToGridDom, cleanOrphanedGridItems } from "./dom/add-grid";
import { type BandLayout, captureBandLayout, enforceBandLayout } from "./dom/band-layout";
import { addVideosToDom } from "./dom/add-shelf";
import { moveVideosToFront } from "./dom/move";
import { findShelfForSection } from "./dom/query";
import { removeVideosFromDom } from "./dom/remove";
import { repositionVideoInSection } from "./dom/reposition";
import { batchUpdateVideosInDom, updateVideoInDom } from "./dom/update";
import {
  deepArray, deepRecord, deepString, isPolymerElement, isRecord, videoIdFromData, videoIdFromShelfListItem
} from "./helpers";
import { type VideoSnapshot, VideoStatus } from "./types";

function readCurrentVideoSections() {
  const sections = new Map<string, string>();
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) continue;
    const sectionTitle = deepString(elShelf.data, "title", "runs", "0", "text");
    for (const elItem of elShelf.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
      if (!isPolymerElement(elItem)) continue;
      const videoId = videoIdFromData(elItem.data);
      if (videoId && !sections.has(videoId)) {
        sections.set(videoId, sectionTitle);
      }
    }
  }

  const elGridContents = document.querySelector<HTMLElement>("ytd-rich-grid-renderer > #contents");
  if (elGridContents) {
    for (const elItem of elGridContents.querySelectorAll<HTMLElement>(":scope > ytd-rich-item-renderer")) {
      if (!isPolymerElement(elItem)) continue;
      const videoId = videoIdFromData(elItem.data);
      if (videoId && !sections.has(videoId)) {
        sections.set(videoId, "");
      }
    }
  }
  return sections;
}

function readCurrentVideoIds() {
  const videoIds = new Set<string>();
  collectFromDomRichItems(videoIds);
  collectFromGridDataModel(videoIds);
  collectFromShelfRenderers(videoIds);
  collectFromRichShelfRenderers(videoIds);
  return videoIds;
}

function collectFromDomRichItems(videoIds: Set<string>) {
  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    if (!isPolymerElement(elItem)) continue;
    const videoId = videoIdFromData(elItem.data);
    if (videoId) videoIds.add(videoId);
  }
}

function collectFromGridDataModel(videoIds: Set<string>) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) return;

  for (const item of deepArray(elGrid.data, "contents")) {
    const videoId = videoIdFromData(deepRecord(item, "richItemRenderer"));
    if (videoId) {
      videoIds.add(videoId);
      continue;
    }

    for (const shelfItem of deepArray(item, "richSectionRenderer", "content", "richShelfRenderer", "contents")) {
      const shelfVideoId = videoIdFromData(deepRecord(shelfItem, "richItemRenderer"));
      if (shelfVideoId) videoIds.add(shelfVideoId);
    }
    for (const listItem of [
      ...deepArray(item, "richSectionRenderer", "content", "shelfRenderer", "content", "horizontalListRenderer", "items"),
      ...deepArray(item, "richSectionRenderer", "content", "shelfRenderer", "content", "gridRenderer", "items")
    ]) {
      const listVideoId = videoIdFromShelfListItem(listItem);
      if (listVideoId) videoIds.add(listVideoId);
    }
  }
}

function collectFromShelfRenderers(videoIds: Set<string>) {
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) continue;
    const shelfContent = deepRecord(elShelf.data, "content");
    for (const listItem of [
      ...deepArray(shelfContent, "horizontalListRenderer", "items"),
      ...deepArray(shelfContent, "gridRenderer", "items")
    ]) {
      const listVideoId = videoIdFromShelfListItem(listItem);
      if (listVideoId) videoIds.add(listVideoId);
    }
  }
}

function collectFromRichShelfRenderers(videoIds: Set<string>) {
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-rich-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) continue;
    for (const item of deepArray(elShelf.data, "contents")) {
      const videoId = videoIdFromData(deepRecord(item, "richItemRenderer"));
      if (videoId) videoIds.add(videoId);
    }
  }
}

interface ClassifiedChanges {
  videoIdsToRemove: string[];
  videosToAdd: VideoSnapshot[];
  videosToReposition: VideoSnapshot[];
  videosToMoveToFront: VideoSnapshot[];
}

function classifyChanges(
  previousSnapshot: Map<string, VideoSnapshot>,
  freshMap: Map<string, VideoSnapshot>,
  currentVideoIds: Set<string>,
  currentVideoSections: Map<string, string>
): ClassifiedChanges {
  const videoIdsToRemove: string[] = [];
  const videosToAdd: VideoSnapshot[] = [];
  const videosToReposition: VideoSnapshot[] = [];
  const videosToMoveToFront: VideoSnapshot[] = [];

  for (const [videoId] of previousSnapshot) {
    if (!freshMap.has(videoId)) {
      videoIdsToRemove.push(videoId);
    }
  }

  for (const [videoId, fresh] of freshMap) {
    if (!currentVideoIds.has(videoId)) {
      videosToAdd.push(fresh);
      continue;
    }

    const previous = previousSnapshot.get(videoId);
    if (!previous) continue;

    if (previous.status === VideoStatus.Upcoming && fresh.status === VideoStatus.Live) {
      videosToMoveToFront.push(fresh);
      continue;
    }

    const isFinishedStream = (previous.status === VideoStatus.Live || previous.status === VideoStatus.Upcoming)
      && fresh.status === VideoStatus.Video;
    if (isFinishedStream) {
      videosToReposition.push(fresh);
      continue;
    }

    classifySectionOrMetadataChange(videoId, previous, fresh, currentVideoSections, videoIdsToRemove, videosToAdd);
  }

  return { videoIdsToRemove, videosToAdd, videosToReposition, videosToMoveToFront };
}

function classifySectionOrMetadataChange(
  videoId: string,
  previous: VideoSnapshot,
  fresh: VideoSnapshot,
  currentVideoSections: Map<string, string>,
  videoIdsToRemove: string[],
  videosToAdd: VideoSnapshot[]
) {
  const currentSection = currentVideoSections.get(videoId);
  const isSectionChange = currentSection !== undefined && currentSection !== fresh.sectionTitle;
  if (isSectionChange) {
    videoIdsToRemove.push(videoId);
    videosToAdd.push(fresh);
    return;
  }

  if (hasMetadataChange(previous, fresh)) {
    updateVideoInDom(videoId, fresh, previous);
  }
}

function hasMetadataChange(previous: VideoSnapshot, fresh: VideoSnapshot) {
  return previous.title !== fresh.title ||
    previous.thumbnailUrl !== fresh.thumbnailUrl ||
    previous.status !== fresh.status ||
    previous.viewCountText !== fresh.viewCountText ||
    previous.publishedTimeText !== fresh.publishedTimeText ||
    previous.isChannelLive !== fresh.isChannelLive;
}

async function executeChanges(
  changes: ClassifiedChanges,
  freshSnapshots: VideoSnapshot[],
  freshMap: Map<string, VideoSnapshot>
) {
  const timeOrderedSnapshots = freshSnapshots.toSorted(
    (videoA, videoB) => parseSecondsAgo(videoA.publishedTimeText) - parseSecondsAgo(videoB.publishedTimeText)
  );
  const shelfVideos = changes.videosToAdd.filter(video => !!findShelfForSection(video.sectionTitle));
  const gridVideos = changes.videosToAdd.filter(video => !findShelfForSection(video.sectionTitle));

  if (changes.videoIdsToRemove.length > 0) {
    await removeVideosFromDom(changes.videoIdsToRemove);
  }

  for (const video of changes.videosToReposition) {
    const sectionVideos = freshSnapshots.filter(snapshot => snapshot.sectionTitle === video.sectionTitle);
    await repositionVideoInSection(video, sectionVideos, freshMap);
  }

  if (shelfVideos.length > 0) {
    await addVideosToDom(shelfVideos, timeOrderedSnapshots, freshMap);
  }

  if (gridVideos.length > 0) {
    await addVideosToGridDom(gridVideos, freshSnapshots);
  }

  if (changes.videosToMoveToFront.length > 0) {
    await moveVideosToFront(changes.videosToMoveToFront, freshSnapshots);
  }
}

function reconcileBandLayout(bandLayout: BandLayout) {
  const freshLayout = captureBandLayout();
  if (freshLayout) {
    for (const [band, count] of freshLayout.bandCaps) {
      const existing = bandLayout.bandCaps.get(band) ?? 0;
      if (count > existing) {
        bandLayout.bandCaps.set(band, count);
      }
    }
  }
  enforceBandLayout(bandLayout);
}

function preserveStaleEntriesForUnremovedVideos(
  videoIdsToRemove: string[],
  previousSnapshot: Map<string, VideoSnapshot>,
  freshMap: Map<string, VideoSnapshot>
) {
  const postChangeVideoIds = readCurrentVideoIds();
  for (const videoId of videoIdsToRemove) {
    const staleVideo = previousSnapshot.get(videoId);
    if (staleVideo && postChangeVideoIds.has(videoId)) {
      freshMap.set(videoId, staleVideo);
    }
  }
}

export async function detectAndApplyChanges(
  previousSnapshot: Map<string, VideoSnapshot>,
  freshSnapshots: VideoSnapshot[],
  bandLayout: BandLayout | null
) {
  const freshMap = new Map(freshSnapshots.map(video => [video.videoId, video]));
  const currentVideoIds = readCurrentVideoIds();
  const currentVideoSections = readCurrentVideoSections();

  const changes = classifyChanges(previousSnapshot, freshMap, currentVideoIds, currentVideoSections);
  const isLayoutChange = changes.videoIdsToRemove.length > 0 ||
    changes.videosToAdd.length > 0 ||
    changes.videosToReposition.length > 0;

  await executeChanges(changes, freshSnapshots, freshMap);
  cleanOrphanedGridItems();

  if (bandLayout) {
    reconcileBandLayout(bandLayout);
  }

  preserveStaleEntriesForUnremovedVideos(changes.videoIdsToRemove, previousSnapshot, freshMap);

  return { isLayoutChange, snapshot: freshMap };
}

export function detectAndApplyMetadataChanges(
  previousSnapshot: Map<string, VideoSnapshot>,
  freshSnapshots: VideoSnapshot[]
) {
  const updatedSnapshot = new Map(previousSnapshot);
  const changedVideos: VideoSnapshot[] = [];

  for (const fresh of freshSnapshots) {
    const previous = previousSnapshot.get(fresh.videoId);
    if (!previous) continue;

    if (hasMetadataChange(previous, fresh)) {
      changedVideos.push(fresh);
      updatedSnapshot.set(fresh.videoId, fresh);
    }
  }

  if (changedVideos.length > 0) {
    batchUpdateVideosInDom(changedVideos, previousSnapshot);
  }

  return updatedSnapshot;
}
