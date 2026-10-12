import type { EndScreenVideoRenderer, InnerTubeWatchNextResponse, WatchNextFeedItem } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";
import { collectAllVideoSnapshots } from "./collect-all-videos";
import { textFromInnerTubeText } from "./renderer-fields";

// Reads the parts of a /next payload the video page shows: the video's own title and channel row,
// one page of the related list, and the suggestions the player paints on its end screen.

const WATCH_NEXT_FEED_TARGET_ID = "watch-next-feed";

export type EndScreenVideo = Pick<VideoSnapshot, "videoId" | "title" | "viewCountText" | "publishedTimeText" | "thumbnailUrl">;

export function currentVideoFromWatchNext(response: Prettify<InnerTubeWatchNextResponse>) {
  const contents = response.contents?.twoColumnWatchNextResults?.results?.results?.contents ?? [];
  const primaryInfo = contents.find(content => content.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer;
  const owner = contents.find(content => content.videoSecondaryInfoRenderer)
    ?.videoSecondaryInfoRenderer?.owner?.videoOwnerRenderer;
  return {
    videoId: response.currentVideoEndpoint?.watchEndpoint?.videoId ?? "",
    title: primaryInfo?.title,
    updatedMetadataCommand: primaryInfo?.updatedMetadataEndpoint,
    subscriberCountText: owner?.subscriberCountText
  };
}

function relatedContinuationToken(items: Prettify<WatchNextFeedItem>[]) {
  const leaves = items.flatMap(item => [item, ...item.itemSectionRenderer?.contents ?? []]);
  for (const leaf of leaves) {
    const token = leaf.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (token) {
      return token;
    }
  }
  return null;
}

function toRelatedPage(items: Prettify<WatchNextFeedItem>[]) {
  return {
    related: collectAllVideoSnapshots(items),
    continuationToken: relatedContinuationToken(items)
  };
}

// The related list as the page first renders it - the "All" chip.
export function relatedPageFromWatchNext(response: Prettify<InnerTubeWatchNextResponse>) {
  return toRelatedPage(response.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results ?? []);
}

// A chip reload or a scroll page of the related list. Comment pages share the endpoint, so only the
// continuation aimed at the related feed counts.
export function relatedPageFromContinuation(response: Prettify<InnerTubeWatchNextResponse>) {
  const items = (response.onResponseReceivedEndpoints ?? []).flatMap(endpoint => {
    const continuation = endpoint.reloadContinuationItemsCommand ?? endpoint.appendContinuationItemsAction;
    const isRelatedFeed = continuation?.targetId === WATCH_NEXT_FEED_TARGET_ID;
    return isRelatedFeed ? continuation.continuationItems ?? [] : [];
  });
  return toRelatedPage(items);
}

type EndScreenVideoFields = Prettify<Pick<EndScreenVideoRenderer, "title" | "shortViewCountText" | "publishedTimeText"> & {
  videoId: string;
  thumbnails: Array<{ url: string }> | undefined;
}>;

function toEndScreenVideo({ videoId, title, shortViewCountText, publishedTimeText, thumbnails }: EndScreenVideoFields) {
  return {
    videoId,
    title: textFromInnerTubeText(title),
    viewCountText: textFromInnerTubeText(shortViewCountText),
    publishedTimeText: textFromInnerTubeText(publishedTimeText),
    thumbnailUrl: thumbnails?.at(-1)?.url ?? ""
  } satisfies EndScreenVideo;
}

// The end-screen wall plus the "Up next" autoplay card, keyed by video id.
export function endScreenVideosFromWatchNext(response: Prettify<InnerTubeWatchNextResponse>) {
  const { endScreen, autoplay } = response.playerOverlays?.playerOverlayRenderer ?? {};
  const videos = new Map<string, Prettify<EndScreenVideo>>();
  for (const { endScreenVideoRenderer } of endScreen?.watchNextEndScreenRenderer?.results ?? []) {
    if (endScreenVideoRenderer) {
      videos.set(
        endScreenVideoRenderer.videoId, toEndScreenVideo({
          ...endScreenVideoRenderer,
          thumbnails: endScreenVideoRenderer.thumbnail?.thumbnails
        })
      );
    }
  }

  const autoplayRenderer = autoplay?.playerOverlayAutoplayRenderer;
  const autoplayVideoId = autoplayRenderer?.videoId;
  if (autoplayVideoId && !videos.has(autoplayVideoId)) {
    videos.set(
      autoplayVideoId, toEndScreenVideo({
        videoId: autoplayVideoId,
        title: autoplayRenderer.videoTitle,
        shortViewCountText: autoplayRenderer.shortViewCountText,
        publishedTimeText: autoplayRenderer.publishedTimeText,
        thumbnails: autoplayRenderer.background?.thumbnails
      })
    );
  }

  return videos;
}
