import type { Prettify } from "../../types/prettify";
import { isOnShortsPage, videoIdFromLocation } from "../../utils/subscriptions-page";
import { textFromInnerTubeText } from "../../youtube-api/guards";
import { fetchWatchNext, type WatchNextSnapshot } from "../../youtube-api/watch-next";
import { applySubscriberCount, applyWatchTitle, refreshNativeVideoMetadata } from "./current-video";
import { applyRelatedUpdates, relatedLockupElements, relatedSections, selectedRelatedChipToken } from "./related-list";
import { pruneDeletedRelated, resetRelatedRemovalTracking } from "./related-removal";
import { applyShortsTitle } from "./shorts-title";

// One refresh of a video page. A watch page re-reads its header and related list from /next; a Short
// only has its overlay title to keep current.

export function resetVideoPageTracking() {
  resetRelatedRemovalTracking();
}

type RefreshVideoPageParams = Prettify<{ videoId: string }>;

type IsStillShowingParams = Prettify<{
  videoId: string;
  watchNext: WatchNextSnapshot;
}>;

// The answer is dropped when the viewer moved on to another video while it was in flight.
function isStillShowing({ videoId, watchNext }: IsStillShowingParams) {
  const isAnswerForVideo = watchNext.videoId === "" || watchNext.videoId === videoId;
  return isAnswerForVideo && videoIdFromLocation() === videoId;
}

async function refreshShorts({ videoId }: RefreshVideoPageParams) {
  const watchNext = await fetchWatchNext({
    videoId,
    selectedChipToken: null,
    displayedRelatedCount: 0
  });
  if (watchNext && isStillShowing({
    videoId,
    watchNext
  })) {
    applyShortsTitle({
      videoId,
      title: textFromInnerTubeText(watchNext.title)
    });
  }
}

async function refreshWatchPage({ videoId }: RefreshVideoPageParams) {
  refreshNativeVideoMetadata(videoId);
  const watchNext = await fetchWatchNext({
    videoId,
    selectedChipToken: selectedRelatedChipToken(),
    displayedRelatedCount: relatedSections().flatMap(relatedLockupElements).length
  });
  if (!watchNext || !isStillShowing({
    videoId,
    watchNext
  })) {
    return;
  }

  const { title, subscriberCountText, related } = watchNext;
  if (title) {
    applyWatchTitle(title);
  }

  if (subscriberCountText) {
    applySubscriberCount(subscriberCountText);
  }

  await Promise.all([
    applyRelatedUpdates(related),
    pruneDeletedRelated(new Set(related.map(fresh => fresh.videoId)))
  ]);
}

export async function refreshVideoPage(params: RefreshVideoPageParams) {
  await (isOnShortsPage() ? refreshShorts(params) : refreshWatchPage(params));
}
