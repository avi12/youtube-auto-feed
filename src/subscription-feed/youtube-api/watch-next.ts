// The video page's data source. /next is the call YouTube makes to build the page itself, so asking it
// again returns the same title, channel row, related list and end screen, only current. The watch page
// HTML is never refetched: that carries a player request, and repeating it soft-blocks the video.
//
// The related list follows what is on screen. A selected chip ("From <channel>", a topic) replaces the
// list with that chip's own feed, and scrolling appends pages to it, so the first page is the chip's
// feed when one is picked and further pages are walked until they cover as many pages as are shown.

import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";
import { isInnerTubeWatchNextResponse } from "./guards";
import { InnerTubeEndpoint, postInnerTube } from "./innertube-request";
import {
  currentVideoFromWatchNext,
  endScreenVideosFromWatchNext,
  relatedPageFromContinuation,
  relatedPageFromWatchNext
} from "./parse-watch-next";

const MAX_RELATED_PAGES = 4;

async function postWatchNext(payload: Record<string, string>) {
  const response = await postInnerTube({
    endpoint: InnerTubeEndpoint.Next,
    payload
  });
  return isInnerTubeWatchNextResponse(response) ? response : null;
}

async function fetchRelatedContinuation(token: string) {
  const response = await postWatchNext({ continuation: token });
  return response ? relatedPageFromContinuation(response) : null;
}

type FetchWatchNextParams = Prettify<{
  videoId: string;
  selectedChipToken: string | null;
  displayedRelatedCount: number;
}>;

export async function fetchWatchNext({ videoId, selectedChipToken, displayedRelatedCount }: FetchWatchNextParams) {
  const [response, chipPage] = await Promise.all([
    postWatchNext({ videoId }),
    selectedChipToken ? fetchRelatedContinuation(selectedChipToken) : null
  ]);
  if (!response) {
    return null;
  }

  const firstPage = selectedChipToken ? chipPage : relatedPageFromWatchNext(response);
  // Each draw of a page varies a little in length, so the pages on screen are counted in whole pages.
  const related: Prettify<VideoSnapshot>[] = [...firstPage?.related ?? []];
  const pageCount = Math.min(MAX_RELATED_PAGES, Math.round(displayedRelatedCount / Math.max(related.length, 1)));
  let continuationToken = firstPage?.continuationToken ?? null;
  for (let iPage = 1; iPage < pageCount && continuationToken; iPage++) {
    const page = await fetchRelatedContinuation(continuationToken);
    related.push(...page?.related ?? []);
    continuationToken = page?.continuationToken ?? null;
  }

  return {
    ...currentVideoFromWatchNext(response),
    related,
    endScreenVideos: endScreenVideosFromWatchNext(response)
  };
}

export type WatchNextSnapshot = NonNullable<Awaited<ReturnType<typeof fetchWatchNext>>>;
