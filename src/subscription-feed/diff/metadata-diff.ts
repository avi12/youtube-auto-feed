import { readGenericDomSnapshot } from "@/subscription-feed/dom/query/query";
import { isThumbnailChanged, isThumbnailUrlRotated } from "@/subscription-feed/dom/rich-item";
import { batchUpdateVideosInDom, reconcileShortsMetadata } from "@/subscription-feed/dom/update";
import type { Prettify } from "@/subscription-feed/types/prettify";
import type { MetadataPart, VideoSnapshot } from "@/subscription-feed/types/video";

function isMetadataPartsChanged(previousParts: MetadataPart[], freshParts: MetadataPart[]) {
  return (
    previousParts.length !== freshParts.length ||
    freshParts.some(
      ({ text, accessibilityLabel }, i) =>
        previousParts[i]?.text !== text || previousParts[i]?.accessibilityLabel !== accessibilityLabel
    )
  );
}

type HasMetadataChangeParams = Prettify<{
  previous: Prettify<VideoSnapshot>;
  fresh: Prettify<VideoSnapshot>;
}>;

export function hasMetadataChange({ previous, fresh }: HasMetadataChangeParams) {
  return (
    previous.title !== fresh.title ||
    isThumbnailChanged({
      previousUrl: previous.thumbnailUrl,
      freshUrl: fresh.thumbnailUrl,
      freshStatus: fresh.status
    }) ||
    isThumbnailUrlRotated({
      previousUrl: previous.thumbnailUrl,
      freshUrl: fresh.thumbnailUrl,
      freshStatus: fresh.status
    }) ||
    previous.status !== fresh.status ||
    previous.viewCountText !== fresh.viewCountText ||
    previous.publishedTimeText !== fresh.publishedTimeText ||
    isMetadataPartsChanged(previous.metadataParts, fresh.metadataParts) ||
    previous.isChannelLive !== fresh.isChannelLive ||
    previous.watchProgressPercent !== fresh.watchProgressPercent
  );
}

type StickyWatchProgressParams = Prettify<{
  fresh: Prettify<VideoSnapshot>;
  previous: Prettify<VideoSnapshot> | undefined;
}>;

// YouTube inconsistently drops the watch-progress overlay; carry the last value
// forward so the tile isn't rebuilt and flickered.
export function withStickyWatchProgress({ fresh, previous }: StickyWatchProgressParams) {
  const isCarryForwardNeeded =
    fresh.watchProgressPercent === null && previous !== undefined && previous.watchProgressPercent !== null;
  if (!isCarryForwardNeeded) {
    return fresh;
  }

  return {
    ...fresh,
    watchProgressPercent: previous.watchProgressPercent
  };
}

type DetectAndApplyMetadataChangesParams = Prettify<{
  previousSnapshot: Map<string, Prettify<VideoSnapshot>>;
  freshSnapshots: Prettify<VideoSnapshot>[];
}>;

export function detectAndApplyMetadataChanges({
  previousSnapshot,
  freshSnapshots
}: DetectAndApplyMetadataChangesParams) {
  reconcileShortsMetadata(freshSnapshots);

  const updatedSnapshot = new Map(previousSnapshot);
  const changedVideos: Prettify<VideoSnapshot>[] = [];

  for (const rawFresh of freshSnapshots) {
    const previous = previousSnapshot.get(rawFresh.videoId);
    if (!previous) {
      continue;
    }

    const fresh = withStickyWatchProgress({
      fresh: rawFresh,
      previous
    });
    const isMetadataChanged = hasMetadataChange({
      previous,
      fresh
    });
    if (!isMetadataChanged) {
      continue;
    }

    changedVideos.push(fresh);
    updatedSnapshot.set(fresh.videoId, {
      ...fresh,
      sectionTitle: previous.sectionTitle,
      bandIndex: previous.bandIndex
    });
  }

  // A deferred (off-viewport) update can be stranded when the grid reflows and rebinds videos to
  // other tile elements before it applies. Keeping the previous snapshot for those ids re-detects
  // the change on the next poll and re-schedules against the elements the video currently occupies.
  const deferredVideoIds = new Set<string>();
  if (changedVideos.length > 0) {
    const appliedVideoIds = batchUpdateVideosInDom({
      freshSnapshots: changedVideos,
      previousSnapshotMap: previousSnapshot
    });
    for (const { videoId } of changedVideos) {
      if (appliedVideoIds.has(videoId)) {
        continue;
      }

      deferredVideoIds.add(videoId);
      const previous = previousSnapshot.get(videoId);
      if (previous) {
        updatedSnapshot.set(videoId, previous);
      }
    }
  }

  return {
    snapshot: updatedSnapshot,
    deferredVideoIds
  };
}

// Page-agnostic metadata pass for non-subscription pages (channel grid + trailer, watch, search,
// home). Stateless: the "previous" is read straight off the live tiles, so each poll just reconciles
// whatever the page currently shows toward the freshly fetched data, with no baseline to seed.
export function applyGenericMetadataUpdates(freshSnapshots: Prettify<VideoSnapshot>[]) {
  reconcileShortsMetadata(freshSnapshots);

  const domSnapshot = readGenericDomSnapshot();
  const changedVideos: Prettify<VideoSnapshot>[] = [];
  for (const fresh of freshSnapshots) {
    const previous = domSnapshot.get(fresh.videoId);
    if (
      previous &&
      hasMetadataChange({
        previous,
        fresh
      })
    ) {
      changedVideos.push(fresh);
    }
  }

  if (changedVideos.length === 0) {
    return;
  }

  batchUpdateVideosInDom({
    freshSnapshots: changedVideos,
    previousSnapshotMap: domSnapshot
  });
}
