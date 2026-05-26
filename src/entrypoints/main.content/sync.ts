import { isShelfRenderer, parseSecondsAgo } from "./api/guards";
import { cascadeInsertVideos } from "./dom/add/cascade";
import { addVideosToGridDom, cleanOrphanedGridItems } from "./dom/add/grid";
import { addVideosToDom } from "./dom/add/shelf";
import { type BandLayout } from "./dom/band-layout";
import { moveVideosToFront } from "./dom/move";
import { removeVideosFromDom } from "./dom/remove";
import { repositionVideoInSection } from "./dom/reposition";
import { batchUpdateVideosInDom, updateVideoInDom } from "./dom/update";
import {
  deepArray,
  isPolymerElement,
  isRecord,
  videoIdFromData,
  videoIdFromShelfListItem
} from "./helpers";
import { type InnerTubeRichGridItem, type Prettify, type VideoSnapshot, VideoStatus } from "./types";

function readCurrentVideoSections() {
  const sections = new Map<string, string>();
  const elGrid = document.querySelector<HTMLElement>("ytd-rich-grid-renderer");
  const isGridReadable = !!elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data);
  if (!isGridReadable) {
    return sections;
  }

  for (const item of deepArray<InnerTubeRichGridItem>(elGrid.data, "contents")) {
    const inlineVideoId = videoIdFromData(item?.richItemRenderer);
    if (inlineVideoId) {
      if (!sections.has(inlineVideoId)) {
        sections.set(inlineVideoId, "");
      }

      continue;
    }

    const richShelfTitle = item?.richSectionRenderer?.content?.richShelfRenderer?.title?.runs?.[0]?.text ?? "";
    for (const shelfItem of deepArray<InnerTubeRichGridItem>(item, "richSectionRenderer", "content", "richShelfRenderer", "contents")) {
      const videoId = videoIdFromData(shelfItem?.richItemRenderer);
      if (videoId && !sections.has(videoId)) {
        sections.set(videoId, richShelfTitle);
      }
    }

    const innerShelfTitle = item?.richSectionRenderer?.content?.shelfRenderer?.title?.runs?.[0]?.text ?? "";
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
  const isGridReadable = !!elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data);
  if (!isGridReadable) {
    return bandIndices;
  }

  let currentBandIndex = 0;
  for (const item of deepArray<InnerTubeRichGridItem>(elGrid.data, "contents")) {
    const inlineVideoId = videoIdFromData(item?.richItemRenderer);
    if (inlineVideoId) {
      if (!bandIndices.has(inlineVideoId)) {
        bandIndices.set(inlineVideoId, currentBandIndex);
      }

      continue;
    }

    if (item?.richSectionRenderer?.content?.richShelfRenderer) {
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
  const isGridReadable = !!elGrid && isPolymerElement(elGrid) && isRecord(elGrid.data);
  if (!isGridReadable) {
    return;
  }

  for (const item of deepArray<InnerTubeRichGridItem>(elGrid.data, "contents")) {
    const videoId = videoIdFromData(item?.richItemRenderer);
    if (videoId) {
      videoIds.add(videoId);
      continue;
    }

    for (const shelfItem of deepArray<InnerTubeRichGridItem>(item, "richSectionRenderer", "content", "richShelfRenderer", "contents")) {
      const shelfVideoId = videoIdFromData(shelfItem?.richItemRenderer);
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

    const shelfContent = isShelfRenderer(elShelf.data) ? elShelf.data.content : undefined;
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

    for (const item of deepArray<InnerTubeRichGridItem>(elShelf.data, "contents")) {
      const videoId = videoIdFromData(item?.richItemRenderer);
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
}

interface FeedDiff {
  removed: string[];
  candidateRemovals: string[];
  added: VideoSnapshot[];
  liveTransitions: VideoSnapshot[];
  finishedStreams: VideoSnapshot[];
  metadataOnly: VideoSnapshot[];
}

interface DiffInputs {
  previousSnapshot: Map<string, VideoSnapshot>;
  freshSnapshots: VideoSnapshot[];
  freshMap: Map<string, VideoSnapshot>;
  currentVideoIds: Set<string>;
  currentVideoSections: Map<string, string>;
  currentVideoBandIndices: Map<string, number>;
  confirmedAbsentVideoIds: Set<string>;
}

// Latest band (sectionTitle === "", bandIndex 0) is the only zone the extension may add/remove videos in.
function isLatestSnapshot(snapshot: Prettify<VideoSnapshot>) {
  return snapshot.sectionTitle === "" && snapshot.bandIndex === 0;
}

function classifyStatusTransition({ previous, fresh }: {
  previous: Prettify<VideoSnapshot>;
  fresh: Prettify<VideoSnapshot>;
}) {
  const isUpcomingToLive = previous.status === VideoStatus.Upcoming && fresh.status === VideoStatus.Live;
  if (isUpcomingToLive) {
    return "upcoming-to-live" as const;
  }

  const wasStreaming = previous.status === VideoStatus.Live || previous.status === VideoStatus.Upcoming;
  const isStreamFinished = wasStreaming && fresh.status === VideoStatus.Video;
  if (isStreamFinished) {
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
  confirmedAbsentVideoIds
}: Prettify<DiffInputs>): Prettify<FeedDiff> {
  const removed: string[] = [];
  const candidateRemovals: string[] = [];
  const added: Prettify<VideoSnapshot>[] = [];
  const liveTransitions: Prettify<VideoSnapshot>[] = [];
  const finishedStreams: Prettify<VideoSnapshot>[] = [];
  const metadataOnly: Prettify<VideoSnapshot>[] = [];

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

    if (!isLatestSnapshot(snapshot)) {
      continue;
    }

    if (currentVideoSections.get(videoId)) {
      continue;
    }

    if ((currentVideoBandIndices.get(videoId) ?? 0) !== 0) {
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
    const previous = previousSnapshot.get(fresh.videoId);
    if (!isLatestSnapshot(fresh)) {
      const isMetadataOnlyChange = !!previous
        && currentVideoIds.has(fresh.videoId)
        && hasMetadataChange({
          previous,
          fresh
        });
      if (isMetadataOnlyChange) {
        metadataOnly.push(fresh);
      }

      continue;
    }

    if (!currentVideoIds.has(fresh.videoId)) {
      added.push(fresh);
      continue;
    }

    if (!previous) {
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

    if ((currentVideoBandIndices.get(fresh.videoId) ?? 0) !== 0) {
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
  confirmedAbsentVideoIds
}: Prettify<DiffInputs>): Prettify<ClassifiedChanges> {
  const { removed, candidateRemovals, added, liveTransitions, finishedStreams, metadataOnly } = computeFeedDiff({
    previousSnapshot,
    freshSnapshots,
    freshMap,
    currentVideoIds,
    currentVideoSections,
    currentVideoBandIndices,
    confirmedAbsentVideoIds
  });

  for (const fresh of metadataOnly) {
    const previous = previousSnapshot.get(fresh.videoId);
    if (previous) {
      updateVideoInDom({
        videoId: fresh.videoId,
        freshSnapshot: fresh,
        previousSnapshot: previous
      });
    }
  }

  for (const fresh of finishedStreams) {
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
    videoIdsToRemove: removed,
    candidateRemovals,
    videosToAdd: added,
    videosToReposition: finishedStreams,
    videosToMoveToFront: liveTransitions
  };
}

function hasMetadataChange({ previous, fresh }: {
  previous: Prettify<VideoSnapshot>;
  fresh: Prettify<VideoSnapshot>;
}) {
  return previous.title !== fresh.title ||
    previous.thumbnailUrl !== fresh.thumbnailUrl ||
    previous.status !== fresh.status ||
    previous.viewCountText !== fresh.viewCountText ||
    previous.publishedTimeText !== fresh.publishedTimeText ||
    previous.isChannelLive !== fresh.isChannelLive ||
    previous.watchProgressPercent !== fresh.watchProgressPercent;
}

async function executeChanges({
  changes,
  freshSnapshots,
  freshMap,
  bandLayout
}: {
  changes: Prettify<ClassifiedChanges>;
  freshSnapshots: Prettify<VideoSnapshot>[];
  freshMap: Map<string, Prettify<VideoSnapshot>>;
  bandLayout: Prettify<BandLayout> | null;
}) {
  const { videoIdsToRemove, videosToAdd, videosToReposition, videosToMoveToFront } = changes;
  const timeOrderedSnapshots = freshSnapshots.toSorted(
    (videoA, videoB) => parseSecondsAgo(videoA.publishedTimeText) - parseSecondsAgo(videoB.publishedTimeText)
  );

  const videoIdsToRemoveSet = new Set(videoIdsToRemove);
  const innerShelfSections = new Set(
    [...document.querySelectorAll<HTMLElement>("ytd-shelf-renderer")]
      .filter(isPolymerElement)
      .map(elShelf => isShelfRenderer(elShelf.data) ? elShelf.data.title?.runs?.[0]?.text ?? "" : "")
      .filter(Boolean)
  );

  const cascadeSectionTitles = new Set(
    bandLayout?.bands.filter(band => band.kind === "richShelf").map(band => band.sectionTitle) ?? []
  );
  const hasInlineBands = bandLayout?.bands.some(band => band.kind === "inline") ?? false;

  // Cascade handles inline Latest additions + known richShelf sections; everything else falls back to direct insert.
  const videosForCascade = bandLayout
    ? videosToAdd.filter(video => {
      const isInlineCascadeCandidate = !video.sectionTitle && video.bandIndex === 0 && hasInlineBands;
      const isShelfCascadeCandidate = !!video.sectionTitle && cascadeSectionTitles.has(video.sectionTitle);
      return isInlineCascadeCandidate || isShelfCascadeCandidate;
    })
    : [];
  const videosForFallback = videosToAdd.filter(
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
  // Videos in both cascade and remove lists are moves; shield them so we don't strip the just-inserted node.
  const shelfProtectedIds = new Set([...cascadeShelfMoveIds, ...shelfFallbackMoveIds]);
  const hasCascadeWork = videosForCascade.length > 0 && bandLayout !== null;
  if (hasCascadeWork) {
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

  if (videoIdsToRemove.length > 0) {
    await removeVideosFromDom({
      videoIds: videoIdsToRemove,
      shelfProtectedIds
    });
  }

  for (const video of videosToReposition) {
    await repositionVideoInSection({
      freshSnapshot: video,
      allSnapshots: freshMap
    });
  }

  if (gridFallbackVideos.length > 0) {
    await addVideosToGridDom({
      videosToAdd: gridFallbackVideos,
      allFreshSnapshots: freshSnapshots
    });
  }

  if (videosToMoveToFront.length > 0) {
    await moveVideosToFront({
      videos: videosToMoveToFront,
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
  previousSnapshot: Map<string, Prettify<VideoSnapshot>>;
  freshMap: Map<string, Prettify<VideoSnapshot>>;
}) {
  const postChangeVideoIds = readCurrentVideoIds();
  for (const videoId of [...videoIdsToRemove, ...candidateRemovals]) {
    const staleVideo = previousSnapshot.get(videoId);
    if (staleVideo && postChangeVideoIds.has(videoId)) {
      freshMap.set(videoId, staleVideo);
    }
  }
}

export async function detectAndApplyChanges({
  previousSnapshot,
  freshSnapshots,
  bandLayout,
  confirmedAbsentVideoIds = new Set()
}: {
  previousSnapshot: Map<string, Prettify<VideoSnapshot>>;
  freshSnapshots: Prettify<VideoSnapshot>[];
  bandLayout: Prettify<BandLayout> | null;
  confirmedAbsentVideoIds?: Set<string>;
}) {
  const freshMap = new Map<string, Prettify<VideoSnapshot>>();
  for (const video of freshSnapshots) {
    const existing = freshMap.get(video.videoId);
    // Latest-band entries take precedence so the snapshot reflects the mutable zone, not shelf duplicates.
    const shouldOverwrite = !existing || !existing.sectionTitle;
    if (shouldOverwrite) {
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
    confirmedAbsentVideoIds
  });
  const { videoIdsToRemove, videosToAdd, videosToReposition, candidateRemovals } = changes;
  // Layout-changing edits invalidate the cached band layout; metadata-only and move-to-front edits don't.
  const isLayoutChange = videoIdsToRemove.length > 0
    || videosToAdd.length > 0
    || videosToReposition.length > 0;

  await executeChanges({
    changes,
    freshSnapshots,
    freshMap,
    bandLayout
  });
  cleanOrphanedGridItems();

  preserveStaleEntriesForUnremovedVideos({
    videoIdsToRemove,
    candidateRemovals,
    previousSnapshot,
    freshMap
  });

  return {
    isLayoutChange,
    snapshot: freshMap,
    candidateRemovals
  };
}

export function detectAndApplyMetadataChanges({
  previousSnapshot,
  freshSnapshots
}: {
  previousSnapshot: Map<string, Prettify<VideoSnapshot>>;
  freshSnapshots: Prettify<VideoSnapshot>[];
}) {
  const updatedSnapshot = new Map(previousSnapshot);
  const changedVideos: Prettify<VideoSnapshot>[] = [];

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
