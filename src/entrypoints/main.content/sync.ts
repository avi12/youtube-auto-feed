import { parseSecondsAgo } from "./api/guards";
import { addVideosToGridDom, cleanOrphanedGridItems } from "./dom/add/grid";
import { addVideosToDom } from "./dom/add/shelf";
import { type BandLayout, captureBandLayout, consolidateStandaloneItems, dismantleAbsentSections, enforceBandLayout, reorderSections } from "./dom/band-layout";
import { moveVideosToFront } from "./dom/move";
import { findShelfForSection } from "./dom/query";
import { removeVideosFromDom } from "./dom/remove";
import { repositionVideoInSection } from "./dom/reposition";
import { batchUpdateVideosInDom, updateVideoInDom } from "./dom/update";
import {
  deepArray,
  deepRecord,
  deepString,
  isPolymerElement,
  isRecord,
  videoIdFromData,
  videoIdFromShelfListItem
} from "./helpers";
import { type VideoSnapshot, VideoStatus } from "./types";

function readCurrentVideoSections() {
  const sections = new Map<string, string>();
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return sections;
  }

  for (const item of deepArray(elGrid.data, "contents")) {
    const inlineVideoId = videoIdFromData(deepRecord(item, "richItemRenderer"));
    if (inlineVideoId) {
      if (!sections.has(inlineVideoId)) {
        sections.set(inlineVideoId, "");
      }
      continue;
    }

    const richShelfTitle = deepString(item, "richSectionRenderer", "content", "richShelfRenderer", "title", "runs", "0", "text");
    for (const shelfItem of deepArray(item, "richSectionRenderer", "content", "richShelfRenderer", "contents")) {
      const videoId = videoIdFromData(deepRecord(shelfItem, "richItemRenderer"));
      if (videoId && !sections.has(videoId)) {
        sections.set(videoId, richShelfTitle);
      }
    }

    const innerShelfTitle = deepString(item, "richSectionRenderer", "content", "shelfRenderer", "title", "runs", "0", "text");
    for (const listItem of [
      ...deepArray(item, "richSectionRenderer", "content", "shelfRenderer", "content", "horizontalListRenderer", "items"),
      ...deepArray(item, "richSectionRenderer", "content", "shelfRenderer", "content", "gridRenderer", "items")
    ]) {
      const videoId = videoIdFromShelfListItem(listItem);
      if (videoId && !sections.has(videoId)) {
        sections.set(videoId, innerShelfTitle);
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
    if (!isPolymerElement(elItem)) {
      continue;
    }

    const videoId = videoIdFromData(elItem.data);
    if (videoId) {
      videoIds.add(videoId);
    }
  }
}

function collectFromGridDataModel(videoIds: Set<string>) {
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return;
  }

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
      const listVideoId = videoIdFromShelfListItem(listItem);
      if (listVideoId) {
        videoIds.add(listVideoId);
      }
    }
  }
}

function collectFromShelfRenderers(videoIds: Set<string>) {
  for (const elShelf of document.querySelectorAll<HTMLElement>("ytd-shelf-renderer")) {
    if (!isPolymerElement(elShelf)) {
      continue;
    }

    const shelfContent = deepRecord(elShelf.data, "content");
    for (const listItem of [
      ...deepArray(shelfContent, "horizontalListRenderer", "items"),
      ...deepArray(shelfContent, "gridRenderer", "items")
    ]) {
      const listVideoId = videoIdFromShelfListItem(listItem);
      if (listVideoId) {
        videoIds.add(listVideoId);
      }
    }
  }
}

function collectFromRichShelfRenderers(videoIds: Set<string>) {
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
}

interface ClassifiedChanges {
  videoIdsToRemove: string[];
  candidateRemovals: string[];
  videosToAdd: VideoSnapshot[];
  videosToReposition: VideoSnapshot[];
  videosToMoveToFront: VideoSnapshot[];
  candidateSectionMoves: { videoId: string; toSection: string }[];
}

interface SectionMove {
  videoId: string;
  fromSection: string;
  toSection: string;
  fresh: VideoSnapshot;
}

interface FeedDiff {
  removed: string[];
  candidateRemovals: string[];
  added: VideoSnapshot[];
  liveTransitions: VideoSnapshot[];
  finishedStreams: VideoSnapshot[];
  sectionMoves: SectionMove[];
  metadataOnly: VideoSnapshot[];
}

function polledShapeMatchesBaseline(polledSectionOrder: string[], bandLayout: BandLayout | null) {
  if (!bandLayout || polledSectionOrder.length === 0) {
    return true;
  }

  const polledSet = new Set(polledSectionOrder);
  const baselineSet = new Set(bandLayout.sectionOrder);
  if (polledSet.size !== baselineSet.size) {
    return false;
  }

  for (const section of polledSet) {
    if (!baselineSet.has(section)) {
      return false;
    }
  }
  return true;
}

function classifyStatusTransition(previous: VideoSnapshot, fresh: VideoSnapshot) {
  if (previous.status === VideoStatus.Upcoming && fresh.status === VideoStatus.Live) {
    return "upcoming-to-live" as const;
  }

  if ((previous.status === VideoStatus.Live || previous.status === VideoStatus.Upcoming) && fresh.status === VideoStatus.Video) {
    return "stream-finished" as const;
  }

  return null;
}

function computeFeedDiff(
  previousSnapshot: Map<string, VideoSnapshot>,
  freshSnapshots: VideoSnapshot[],
  freshMap: Map<string, VideoSnapshot>,
  currentVideoIds: Set<string>,
  currentVideoSections: Map<string, string>,
  confirmedAbsentVideoIds: Set<string>
): FeedDiff {
  const removed: string[] = [];
  const candidateRemovals: string[] = [];
  const added: VideoSnapshot[] = [];
  const liveTransitions: VideoSnapshot[] = [];
  const finishedStreams: VideoSnapshot[] = [];
  const sectionMoves: SectionMove[] = [];
  const metadataOnly: VideoSnapshot[] = [];

  for (const [videoId] of previousSnapshot) {
    if (!freshMap.has(videoId)) {
      candidateRemovals.push(videoId);
      if (confirmedAbsentVideoIds.has(videoId)) {
        removed.push(videoId);
      }
    }
  }

  for (const fresh of freshSnapshots) {
    if (!currentVideoIds.has(fresh.videoId)) {
      added.push(fresh);
      continue;
    }

    const previous = previousSnapshot.get(fresh.videoId);
    if (!previous) {
      continue;
    }

    const transition = classifyStatusTransition(previous, fresh);
    if (transition === "upcoming-to-live") {
      liveTransitions.push(fresh); continue;
    }

    if (transition === "stream-finished") {
      finishedStreams.push(fresh); continue;
    }

    const currentSection = currentVideoSections.get(fresh.videoId);
    if (currentSection !== undefined && currentSection !== fresh.sectionTitle) {
      sectionMoves.push({
        videoId: fresh.videoId,
        fromSection: currentSection,
        toSection: fresh.sectionTitle,
        fresh
      });
      continue;
    }

    if (hasMetadataChange(previous, fresh)) {
      metadataOnly.push(fresh);
    }
  }

  return {
    removed,
    candidateRemovals,
    added,
    liveTransitions,
    finishedStreams,
    sectionMoves,
    metadataOnly
  };
}

function classifyChanges(
  previousSnapshot: Map<string, VideoSnapshot>,
  freshSnapshots: VideoSnapshot[],
  freshMap: Map<string, VideoSnapshot>,
  currentVideoIds: Set<string>,
  currentVideoSections: Map<string, string>,
  bandLayout: BandLayout | null,
  polledSectionOrder: string[],
  confirmedAbsentVideoIds: Set<string>,
  confirmedSectionMoves: Set<string>
): ClassifiedChanges {
  const diff = computeFeedDiff(previousSnapshot, freshSnapshots, freshMap, currentVideoIds, currentVideoSections, confirmedAbsentVideoIds);
  const isShapeMatch = polledShapeMatchesBaseline(polledSectionOrder, bandLayout);

  for (const move of diff.sectionMoves) {
    if ((isShapeMatch || move.toSection || move.fromSection) && confirmedSectionMoves.has(move.videoId)) {
      diff.removed.push(move.videoId);
      diff.added.push(move.fresh);
    }
  }

  for (const fresh of diff.metadataOnly) {
    const previous = previousSnapshot.get(fresh.videoId);
    if (previous) {
      updateVideoInDom(fresh.videoId, fresh, previous);
    }
  }

  return {
    videoIdsToRemove: diff.removed,
    candidateRemovals: diff.candidateRemovals,
    videosToAdd: diff.added,
    videosToReposition: diff.finishedStreams,
    videosToMoveToFront: diff.liveTransitions,
    candidateSectionMoves: diff.sectionMoves.map(({ videoId, toSection }) => ({ videoId, toSection }))
  };
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
  if (changes.videoIdsToRemove.length > 0) {
    await removeVideosFromDom(changes.videoIdsToRemove);
  }

  for (const video of changes.videosToReposition) {
    const sectionVideos = freshSnapshots.filter(snapshot => snapshot.sectionTitle === video.sectionTitle);
    await repositionVideoInSection(video, sectionVideos, freshMap);
  }

  const shelfVideos = changes.videosToAdd.filter(video => !!findShelfForSection(video.sectionTitle));
  const gridVideos = changes.videosToAdd.filter(video => !findShelfForSection(video.sectionTitle));

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
  candidateRemovals: string[],
  previousSnapshot: Map<string, VideoSnapshot>,
  freshMap: Map<string, VideoSnapshot>
) {
  const postChangeVideoIds = readCurrentVideoIds();
  for (const videoId of [...videoIdsToRemove, ...candidateRemovals]) {
    const staleVideo = previousSnapshot.get(videoId);
    if (staleVideo && postChangeVideoIds.has(videoId)) {
      freshMap.set(videoId, staleVideo);
    }
  }
}

function reconcileShelfOrders(freshSnapshots: VideoSnapshot[]) {
  const sectionGroups = new Map<string, string[]>();
  for (const video of freshSnapshots) {
    if (!video.sectionTitle) {
      continue;
    }
    const ids = sectionGroups.get(video.sectionTitle) ?? [];
    ids.push(video.videoId);
    sectionGroups.set(video.sectionTitle, ids);
  }

  for (const [sectionTitle, apiVideoIds] of sectionGroups) {
    const elShelf = findShelfForSection(sectionTitle);
    if (!elShelf || !isPolymerElement(elShelf)) {
      continue;
    }

    const shelfContents = deepArray(elShelf.data, "contents");
    const domVideoIds = shelfContents
      .map(item => videoIdFromData(deepRecord(item, "richItemRenderer")))
      .filter((id): id is string => !!id);

    if (domVideoIds.length !== apiVideoIds.length) {
      continue;
    }

    const apiSet = new Set(apiVideoIds);
    if (!domVideoIds.every(id => apiSet.has(id))) {
      continue;
    }

    if (domVideoIds.join(",") === apiVideoIds.join(",")) {
      continue;
    }

    const itemByVideoId = new Map<string, unknown>();
    for (const item of shelfContents) {
      const id = videoIdFromData(deepRecord(item, "richItemRenderer"));
      if (id) {
        itemByVideoId.set(id, item);
      }
    }

    const reorderedContents = apiVideoIds.map(id => itemByVideoId.get(id)).filter(Boolean);
    elShelf.set("data.contents", reorderedContents);
  }
}

export async function detectAndApplyChanges(
  previousSnapshot: Map<string, VideoSnapshot>,
  freshSnapshots: VideoSnapshot[],
  bandLayout: BandLayout | null,
  polledSectionOrder: string[] = [],
  confirmedAbsentVideoIds: Set<string> = new Set(),
  confirmedAbsentSections: Set<string> = new Set(),
  confirmedSectionMoves: Set<string> = new Set()
) {
  const freshMap = new Map(freshSnapshots.map(video => [video.videoId, video]));
  const currentVideoIds = readCurrentVideoIds();
  const currentVideoSections = readCurrentVideoSections();

  const changes = classifyChanges(previousSnapshot, freshSnapshots, freshMap, currentVideoIds, currentVideoSections, bandLayout, polledSectionOrder, confirmedAbsentVideoIds, confirmedSectionMoves);
  const isLayoutChange = changes.videoIdsToRemove.length > 0 ||
    changes.videosToAdd.length > 0 ||
    changes.videosToReposition.length > 0;

  await executeChanges(changes, freshSnapshots, freshMap);
  const extensionAddedSectionIds = new Set(changes.videosToAdd.filter(video => !!video.sectionTitle).map(video => video.videoId));
  cleanOrphanedGridItems(extensionAddedSectionIds);
  reconcileShelfOrders(freshSnapshots);
  let candidateSectionRemovals: string[] = [];
  if (polledSectionOrder.length > 0) {
    candidateSectionRemovals = dismantleAbsentSections(polledSectionOrder, confirmedAbsentSections);
  }
  consolidateStandaloneItems();
  if (polledSectionOrder.length > 0) {
    reorderSections(polledSectionOrder);
  }

  if (bandLayout) {
    reconcileBandLayout(bandLayout);
  }

  preserveStaleEntriesForUnremovedVideos(changes.videoIdsToRemove, changes.candidateRemovals, previousSnapshot, freshMap);

  return {
    isLayoutChange,
    snapshot: freshMap,
    candidateRemovals: changes.candidateRemovals,
    candidateSectionRemovals,
    candidateSectionMoves: changes.candidateSectionMoves
  };
}

export function detectAndApplyMetadataChanges(
  previousSnapshot: Map<string, VideoSnapshot>,
  freshSnapshots: VideoSnapshot[]
) {
  const updatedSnapshot = new Map(previousSnapshot);
  const changedVideos: VideoSnapshot[] = [];

  for (const fresh of freshSnapshots) {
    const previous = previousSnapshot.get(fresh.videoId);
    if (!previous) {
      continue;
    }

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
