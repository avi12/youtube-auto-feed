import { parseSecondsAgo } from "./api/guards";
import { cascadeInsertVideos } from "./dom/add/cascade";
import { addVideosToGridDom, cleanOrphanedGridItems } from "./dom/add/grid";
import { addVideosToDom } from "./dom/add/shelf";
import { type BandLayout } from "./dom/band-layout";
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

function readCurrentVideoBandIndices() {
  const bandIndices = new Map<string, number>();
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  if (!elGrid || !isPolymerElement(elGrid) || !isRecord(elGrid.data)) {
    return bandIndices;
  }

  let currentBandIndex = 0;
  for (const item of deepArray(elGrid.data, "contents")) {
    const inlineVideoId = videoIdFromData(deepRecord(item, "richItemRenderer"));
    if (inlineVideoId) {
      if (!bandIndices.has(inlineVideoId)) {
        bandIndices.set(inlineVideoId, currentBandIndex);
      }

      continue;
    }

    if (deepRecord(item, "richSectionRenderer", "content", "richShelfRenderer")) {
      currentBandIndex++;
    }
  }

  return bandIndices;
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
  candidateSectionMoves: {
    videoId: string;
    toSection: string;
  }[];
}

interface SectionMove {
  videoId: string;
  fromSection: string;
  toSection: string;
  fresh: VideoSnapshot;
}

interface BandMove {
  videoId: string;
  fromBandIndex: number;
  toBandIndex: number;
  fresh: VideoSnapshot;
}

interface FeedDiff {
  removed: string[];
  candidateRemovals: string[];
  added: VideoSnapshot[];
  liveTransitions: VideoSnapshot[];
  finishedStreams: VideoSnapshot[];
  sectionMoves: SectionMove[];
  bandMoves: BandMove[];
  metadataOnly: VideoSnapshot[];
}

function polledShapeMatchesBaseline({ polledSectionOrder, bandLayout }: {
  polledSectionOrder: string[];
  bandLayout: BandLayout | null;
}) {
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

function classifyStatusTransition({ previous, fresh }: {
  previous: VideoSnapshot;
  fresh: VideoSnapshot;
}) {
  if (previous.status === VideoStatus.Upcoming && fresh.status === VideoStatus.Live) {
    return "upcoming-to-live" as const;
  }

  const wasStreaming = previous.status === VideoStatus.Live || previous.status === VideoStatus.Upcoming;
  if (wasStreaming && fresh.status === VideoStatus.Video) {
    return "stream-finished" as const;
  }

  return null;
}

function computeFeedDiff({
  previousSnapshot,
  freshSnapshots,
  freshMap,
  currentVideoIds,
  currentVideoSections,
  currentVideoBandIndices,
  confirmedAbsentVideoIds,
  knownApiSections
}: {
  previousSnapshot: Map<string, VideoSnapshot>;
  freshSnapshots: VideoSnapshot[];
  freshMap: Map<string, VideoSnapshot>;
  currentVideoIds: Set<string>;
  currentVideoSections: Map<string, string>;
  currentVideoBandIndices: Map<string, number>;
  confirmedAbsentVideoIds: Set<string>;
  knownApiSections: Set<string>;
}): FeedDiff {
  const removed: string[] = [];
  const candidateRemovals: string[] = [];
  const added: VideoSnapshot[] = [];
  const liveTransitions: VideoSnapshot[] = [];
  const finishedStreams: VideoSnapshot[] = [];
  const sectionMoves: SectionMove[] = [];
  const bandMoves: BandMove[] = [];
  const metadataOnly: VideoSnapshot[] = [];

  const apiInlineSecondsAgo = freshSnapshots
    .filter(video => !video.sectionTitle)
    .map(video => parseSecondsAgo(video.publishedTimeText));
  const apiInlineOldestSecondsAgo = apiInlineSecondsAgo.length > 0
    ? Math.max(...apiInlineSecondsAgo)
    : Infinity;

  for (const [videoId, snapshot] of previousSnapshot) {
    if (freshMap.has(videoId)) {
      continue;
    }

    if (snapshot.sectionTitle) {
      continue;
    }

    if (currentVideoSections.get(videoId)) {
      continue;
    }

    if (parseSecondsAgo(snapshot.publishedTimeText) > apiInlineOldestSecondsAgo) {
      continue;
    }

    if (confirmedAbsentVideoIds.has(videoId)) {
      removed.push(videoId);
    } else {
      candidateRemovals.push(videoId);
    }
  }

  for (const fresh of freshSnapshots) {
    if (!currentVideoIds.has(fresh.videoId)) {
      added.push(fresh);
      continue;
    }

    const previous = previousSnapshot.get(fresh.videoId);
    if (!previous) {
      const currentSection = currentVideoSections.get(fresh.videoId);
      if (currentSection !== undefined && currentSection !== fresh.sectionTitle && currentSection !== "") {
        sectionMoves.push({
          videoId: fresh.videoId,
          fromSection: currentSection,
          toSection: fresh.sectionTitle,
          fresh
        });
      }

      continue;
    }

    const transition = classifyStatusTransition({
      previous,
      fresh
    });
    if (transition === "upcoming-to-live") {
      liveTransitions.push(fresh); continue;
    }

    if (transition === "stream-finished") {
      finishedStreams.push(fresh); continue;
    }

    const currentSection = currentVideoSections.get(fresh.videoId);
    if (currentSection !== undefined && currentSection !== fresh.sectionTitle) {
      if (currentSection && !fresh.sectionTitle) {
        if (hasMetadataChange({
          previous,
          fresh
        })) {
          metadataOnly.push(fresh);
        }

        continue;
      }

      if (currentSection && !knownApiSections.has(currentSection)) {
        if (hasMetadataChange({
          previous,
          fresh
        })) {
          metadataOnly.push(fresh);
        }

        continue;
      }

      sectionMoves.push({
        videoId: fresh.videoId,
        fromSection: currentSection,
        toSection: fresh.sectionTitle,
        fresh
      });
      continue;
    }

    const currentBandIndex = currentVideoBandIndices.get(fresh.videoId);
    if (fresh.sectionTitle === "" && currentBandIndex !== undefined && fresh.bandIndex > currentBandIndex) {
      bandMoves.push({
        videoId: fresh.videoId,
        fromBandIndex: currentBandIndex,
        toBandIndex: fresh.bandIndex,
        fresh
      });
      continue;
    }

    if (hasMetadataChange({
      previous,
      fresh
    })) {
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
    bandMoves,
    metadataOnly
  };
}

function classifyChanges({
  previousSnapshot,
  freshSnapshots,
  freshMap,
  currentVideoIds,
  currentVideoSections,
  currentVideoBandIndices,
  bandLayout,
  polledSectionOrder,
  confirmedAbsentVideoIds,
  confirmedSectionMoves,
  isInitialLoad
}: {
  previousSnapshot: Map<string, VideoSnapshot>;
  freshSnapshots: VideoSnapshot[];
  freshMap: Map<string, VideoSnapshot>;
  currentVideoIds: Set<string>;
  currentVideoSections: Map<string, string>;
  currentVideoBandIndices: Map<string, number>;
  bandLayout: BandLayout | null;
  polledSectionOrder: string[];
  confirmedAbsentVideoIds: Set<string>;
  confirmedSectionMoves: Set<string>;
  isInitialLoad: boolean;
}): ClassifiedChanges {
  const diff = computeFeedDiff({
    previousSnapshot,
    freshSnapshots,
    freshMap,
    currentVideoIds,
    currentVideoSections,
    currentVideoBandIndices,
    confirmedAbsentVideoIds,
    knownApiSections: new Set(polledSectionOrder)
  });
  const isShapeMatch = polledShapeMatchesBaseline({
    polledSectionOrder,
    bandLayout
  });

  for (const move of diff.sectionMoves) {
    if (!move.toSection) {
      continue;
    }

    const isMoveShapeOk = isShapeMatch || move.toSection || move.fromSection;
    const isMoveConfirmed = confirmedSectionMoves.has(move.videoId) || isInitialLoad;
    if (isMoveShapeOk && isMoveConfirmed) {
      diff.removed.push(move.videoId);
      diff.added.push(move.fresh);
    }
  }

  for (const move of diff.bandMoves) {
    if (isInitialLoad) {
      diff.removed.push(move.videoId);
      diff.added.push(move.fresh);
    }
  }

  for (const fresh of diff.metadataOnly) {
    const previous = previousSnapshot.get(fresh.videoId);
    if (previous) {
      updateVideoInDom({
        videoId: fresh.videoId,
        freshSnapshot: fresh,
        previousSnapshot: previous
      });
    }
  }

  for (const fresh of diff.finishedStreams) {
    const previous = previousSnapshot.get(fresh.videoId);
    if (previous) {
      updateVideoInDom({
        videoId: fresh.videoId,
        freshSnapshot: fresh,
        previousSnapshot: previous
      });
    }
  }

  return {
    videoIdsToRemove: diff.removed,
    candidateRemovals: diff.candidateRemovals,
    videosToAdd: diff.added,
    videosToReposition: diff.finishedStreams,
    videosToMoveToFront: diff.liveTransitions,
    candidateSectionMoves: diff.sectionMoves.map(({ videoId, toSection }) => ({
      videoId,
      toSection
    }))
  };
}

function readWatchProgress(snapshot: VideoSnapshot) {
  const overlays = deepArray(snapshot.rawRenderer, "contentImage", "thumbnailViewModel", "overlays");
  for (const overlay of overlays) {
    const percent = deepRecord(overlay, "thumbnailBottomOverlayViewModel", "progressBar", "thumbnailOverlayProgressBarViewModel")?.startPercent;
    if (typeof percent === "number") {
      return percent;
    }
  }
  return null;
}

function hasMetadataChange({ previous, fresh }: {
  previous: VideoSnapshot;
  fresh: VideoSnapshot;
}) {
  return previous.title !== fresh.title ||
    previous.thumbnailUrl !== fresh.thumbnailUrl ||
    previous.status !== fresh.status ||
    previous.viewCountText !== fresh.viewCountText ||
    previous.publishedTimeText !== fresh.publishedTimeText ||
    previous.isChannelLive !== fresh.isChannelLive ||
    readWatchProgress(previous) !== readWatchProgress(fresh);
}

async function executeChanges({
  changes,
  freshSnapshots,
  freshMap,
  bandLayout
}: {
  changes: ClassifiedChanges;
  freshSnapshots: VideoSnapshot[];
  freshMap: Map<string, VideoSnapshot>;
  bandLayout: BandLayout | null;
}) {
  const timeOrderedSnapshots = freshSnapshots.toSorted(
    (videoA, videoB) => parseSecondsAgo(videoA.publishedTimeText) - parseSecondsAgo(videoB.publishedTimeText)
  );

  const videoIdsToRemoveSet = new Set(changes.videoIdsToRemove);
  const innerShelfSections = new Set(
    [...document.querySelectorAll<HTMLElement>("ytd-shelf-renderer")]
      .filter(isPolymerElement)
      .map(elShelf => deepString(elShelf.data, "title", "runs", "0", "text"))
      .filter(Boolean)
  );

  const cascadeSectionTitles = new Set(
    bandLayout?.bands.filter(band => band.kind === "richShelf").map(band => band.sectionTitle) ?? []
  );
  const hasInlineBands = bandLayout?.bands.some(band => band.kind === "inline") ?? false;

  const videosForCascade = bandLayout
    ? changes.videosToAdd.filter(video =>
      (!video.sectionTitle && video.bandIndex === 0 && hasInlineBands) ||
      (!!video.sectionTitle && cascadeSectionTitles.has(video.sectionTitle)))
    : [];
  const videosForFallback = changes.videosToAdd.filter(
    video => !videosForCascade.includes(video) && !innerShelfSections.has(video.sectionTitle)
  );
  const gridFallbackVideos = videosForFallback.filter(video => !video.sectionTitle);
  const shelfFallbackVideos = videosForFallback.filter(video => !!video.sectionTitle);

  const cascadeShelfMoveIds = new Set(
    videosForCascade
      .filter(video => !!video.sectionTitle && videoIdsToRemoveSet.has(video.videoId))
      .map(video => video.videoId)
  );
  const shelfFallbackMoveIds = new Set(
    shelfFallbackVideos.filter(video => videoIdsToRemoveSet.has(video.videoId)).map(video => video.videoId)
  );
  const shelfProtectedIds = new Set([...cascadeShelfMoveIds, ...shelfFallbackMoveIds]);  if (videosForCascade.length > 0 && bandLayout) {
    await cascadeInsertVideos({
      videosToAdd: videosForCascade,
      bandLayout
    });
  }

  if (shelfFallbackVideos.length > 0) {
    await addVideosToDom({
      freshSnapshots: shelfFallbackVideos,
      allFreshSnapshots: timeOrderedSnapshots,
      snapshot: freshMap
    });
  }

  if (changes.videoIdsToRemove.length > 0) {
    await removeVideosFromDom({
      videoIds: changes.videoIdsToRemove,
      shelfProtectedIds
    });
  }

  for (const video of changes.videosToReposition) {
    const sectionVideos = freshSnapshots.filter(snapshot => snapshot.sectionTitle === video.sectionTitle);
    await repositionVideoInSection({
      freshSnapshot: video,
      sectionVideos,
      allSnapshots: freshMap
    });
  }

  if (gridFallbackVideos.length > 0) {
    await addVideosToGridDom({
      videosToAdd: gridFallbackVideos,
      allFreshSnapshots: freshSnapshots
    });
  }

  if (changes.videosToMoveToFront.length > 0) {
    await moveVideosToFront({
      videos: changes.videosToMoveToFront,
      allFreshSnapshots: freshSnapshots
    });
  }
}

function preserveStaleEntriesForUnremovedVideos({
  videoIdsToRemove,
  candidateRemovals,
  previousSnapshot,
  freshMap
}: {
  videoIdsToRemove: string[];
  candidateRemovals: string[];
  previousSnapshot: Map<string, VideoSnapshot>;
  freshMap: Map<string, VideoSnapshot>;
}) {
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
    if (shelfContents.some(item => !!deepRecord(item, "richItemRenderer", "content", "shortsLockupViewModel"))) {
      continue;
    }

    const domVideoIds = shelfContents
      .map(item => videoIdFromData(deepRecord(item, "richItemRenderer")))
      .filter((id): id is string => !!id);    if (domVideoIds.length !== apiVideoIds.length) {
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

export async function detectAndApplyChanges({
  previousSnapshot,
  freshSnapshots,
  bandLayout,
  polledSectionOrder = [],
  confirmedAbsentVideoIds = new Set(),
  confirmedSectionMoves = new Set(),
  isInitialLoad = false
}: {
  previousSnapshot: Map<string, VideoSnapshot>;
  freshSnapshots: VideoSnapshot[];
  bandLayout: BandLayout | null;
  polledSectionOrder?: string[];
  confirmedAbsentVideoIds?: Set<string>;
  confirmedSectionMoves?: Set<string>;
  isInitialLoad?: boolean;
}) {
  const freshMap = new Map<string, VideoSnapshot>();
  for (const video of freshSnapshots) {
    const existing = freshMap.get(video.videoId);
    if (!existing || !existing.sectionTitle) {
      freshMap.set(video.videoId, video);
    }
  }
  const currentVideoIds = readCurrentVideoIds();
  const currentVideoSections = readCurrentVideoSections();
  const currentVideoBandIndices = readCurrentVideoBandIndices();

  const changes = classifyChanges({
    previousSnapshot,
    freshSnapshots,
    freshMap,
    currentVideoIds,
    currentVideoSections,
    currentVideoBandIndices,
    bandLayout,
    polledSectionOrder,
    confirmedAbsentVideoIds,
    confirmedSectionMoves,
    isInitialLoad
  });
  const isLayoutChange = changes.videoIdsToRemove.length > 0 ||
    changes.videosToAdd.length > 0 ||
    changes.videosToReposition.length > 0;

  await executeChanges({
    changes,
    freshSnapshots,
    freshMap,
    bandLayout
  });
  cleanOrphanedGridItems();

  if (changes.videosToAdd.length > 0) {
    reconcileShelfOrders(freshSnapshots);
  }

  preserveStaleEntriesForUnremovedVideos({
    videoIdsToRemove: changes.videoIdsToRemove,
    candidateRemovals: changes.candidateRemovals,
    previousSnapshot,
    freshMap
  });

  return {
    isLayoutChange,
    snapshot: freshMap,
    candidateRemovals: changes.candidateRemovals,
    candidateSectionMoves: changes.candidateSectionMoves
  };
}

export function detectAndApplyMetadataChanges({
  previousSnapshot,
  freshSnapshots
}: {
  previousSnapshot: Map<string, VideoSnapshot>;
  freshSnapshots: VideoSnapshot[];
}) {
  const updatedSnapshot = new Map(previousSnapshot);
  const changedVideos: VideoSnapshot[] = [];

  for (const fresh of freshSnapshots) {
    const previous = previousSnapshot.get(fresh.videoId);
    if (!previous) {
      continue;
    }

    if (hasMetadataChange({
      previous,
      fresh
    })) {
      changedVideos.push(fresh);
      updatedSnapshot.set(fresh.videoId, {
        ...fresh,
        sectionTitle: previous.sectionTitle,
        bandIndex: previous.bandIndex
      });
    }
  }

  if (changedVideos.length > 0) {
    batchUpdateVideosInDom({
      freshSnapshots: changedVideos,
      previousSnapshotMap: previousSnapshot
    });
  }

  return updatedSnapshot;
}
