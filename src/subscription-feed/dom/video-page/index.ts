import type { Prettify } from "../../types/prettify";
import { isOnShortsPage, videoIdFromLocation } from "../../utils/subscriptions-page";
import { textFromInnerTubeText } from "../../youtube-api/guards";
import type { EndScreenVideo } from "../../youtube-api/parse-watch-next";
import { fetchWatchNext, type WatchNextSnapshot } from "../../youtube-api/watch-next";
import { applySubscriberCount, applyWatchTitle, refreshNativeVideoMetadata } from "./current-video";
import { applyEndScreenUpdates, refreshEndScreenPictures, resetEndScreenTracking } from "./end-screen";
import { isPlayerInMode, PlayerMode, refreshUnstartedPlayerThumbnail } from "./player-pictures";
import { applyRelatedUpdates, relatedLockupElements, relatedSections, selectedRelatedChipToken } from "./related-list";
import { pruneDeletedRelated, resetRelatedRemovalTracking } from "./related-removal";
import { applyShortsTitle } from "./shorts-title";

// One refresh of a video page. A watch page re-reads its header, related list and end screen from /next;
// a Short only has its overlay title to keep current. Pictures are byte-checked on their own, slower
// cadence, since each check downloads the image again.

export { isMainPlayerVideo } from "./player-pictures";

export function resetVideoPageTracking() {
  resetRelatedRemovalTracking();
  resetEndScreenTracking();
}

type RefreshVideoPageParams = Prettify<{
  videoId: string;
  isPictureCheckDue: boolean;
}>;

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

// The end screen is a draw of suggestions like the related list, worded the same short way, so a tile
// this draw of the end screen left out is still refreshed when the related list has its video.
function endScreenCandidates({ related, endScreenVideos }: WatchNextSnapshot) {
  const candidates = new Map<string, Prettify<EndScreenVideo>>(related.map(fresh => [fresh.videoId, fresh]));
  for (const [videoId, video] of endScreenVideos) {
    candidates.set(videoId, video);
  }
  return candidates;
}

async function refreshWatchPage({ videoId, isPictureCheckDue }: RefreshVideoPageParams) {
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

  const isEnded = isPlayerInMode(PlayerMode.Ended);
  await Promise.all([
    applyRelatedUpdates(related),
    pruneDeletedRelated(new Set(related.map(fresh => fresh.videoId))),
    isEnded ? applyEndScreenUpdates(endScreenCandidates(watchNext)) : null
  ]);
  await Promise.all([
    isPictureCheckDue ? refreshUnstartedPlayerThumbnail() : null,
    isEnded ? refreshEndScreenPictures(isPictureCheckDue) : null
  ]);
}

export async function refreshVideoPage(params: RefreshVideoPageParams) {
  await (isOnShortsPage() ? refreshShorts(params) : refreshWatchPage(params));
}
