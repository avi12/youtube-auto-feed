import { z } from "../../../shared/zod";
import type { InnerTubeText } from "../../types/innertube";
import type { Prettify } from "../../types/prettify";
import { isCommandResolver, isPolymerElement } from "../../utils/polymer";
import { isInnerTubeWatchNextResponse, textFromInnerTubeText } from "../../youtube-api/guards";
import { currentVideoFromWatchNext } from "../../youtube-api/parse-watch-next";
import { titleSchema } from "../../youtube-api/schemas";
import { triggerAnimation } from "../animations";

// The watch page's own header: title, channel row, view count, likes and date. Each is changed the way
// YouTube changes it itself, so the page renders the new value with its own components - the view
// count rolls its digits, the tab title follows the heading - instead of having text written over it.

const APP_SELECTOR = "ytd-app";
const WATCH_FLEXY_SELECTOR = "ytd-watch-flexy";
const WATCH_TITLE_SELECTOR = "ytd-watch-metadata #title h1";
const OWNER_SELECTOR = "ytd-watch-metadata ytd-video-owner-renderer";
const OWNER_SUBSCRIBER_COUNT_SELECTOR = "#owner-sub-count";
const PAGE_TITLE_UPDATE_EVENT = "yt-update-title";
const UPDATED_METADATA_API_URL = "/youtubei/v1/updated_metadata";

const ownerDataSchema = z.looseObject({ subscriberCountText: titleSchema.optional() });

function findWatchFlexy() {
  const elFlexy = document.querySelector(WATCH_FLEXY_SELECTOR);
  return elFlexy && isPolymerElement(elFlexy) && isCommandResolver(elFlexy) ? elFlexy : null;
}

// The page's own copy of /next - what the header and the player's end screen were built from.
export function pageWatchNext() {
  const elFlexy = findWatchFlexy();
  return elFlexy && isInnerTubeWatchNextResponse(elFlexy.data) ? elFlexy.data : null;
}

// View count, likes and date come from the endpoint YouTube itself polls for this video (every few
// minutes for an upload, every few seconds for a stream). Resolving YouTube's own command makes YouTube
// fetch it and apply the answer through its own handlers, so nothing here models that response. Only
// some videos carry the command; built from the video id alone it is answered and applied the same way.
export function refreshNativeVideoMetadata(videoId: string) {
  const elFlexy = findWatchFlexy();
  const watchNext = pageWatchNext();
  if (!elFlexy || !watchNext) {
    return;
  }

  const { videoId: pageVideoId, updatedMetadataCommand } = currentVideoFromWatchNext(watchNext);
  if (pageVideoId !== videoId) {
    return;
  }

  elFlexy.resolveCommand(
    updatedMetadataCommand ?? {
      commandMetadata: {
        webCommandMetadata: {
          sendPost: true,
          apiUrl: UPDATED_METADATA_API_URL
        }
      },
      updatedMetadataEndpoint: { videoId }
    }
  );
}

// The tab title follows the event YouTube fires when a stream's title changes mid-broadcast.
export function updatePageTitle(title: string) {
  document.querySelector(APP_SELECTOR)?.dispatchEvent(new CustomEvent(PAGE_TITLE_UPDATE_EVENT, { detail: title }));
}

export function applyWatchTitle(title: Prettify<InnerTubeText>) {
  const freshTitle = textFromInnerTubeText(title);
  const elTitle = document.querySelector<HTMLElement>(WATCH_TITLE_SELECTOR);
  const elFlexy = findWatchFlexy();
  const isTitleChanged = !!elTitle && freshTitle !== "" && elTitle.textContent.trim() !== freshTitle;
  if (!isTitleChanged || !elFlexy) {
    return;
  }

  elFlexy.resolveCommand({
    updateTitleAction: { title }
  });
  updatePageTitle(freshTitle);
  triggerAnimation({
    elTarget: elTitle,
    animationClass: "ytaf-updated"
  });
}

export function applySubscriberCount(subscriberCountText: Prettify<InnerTubeText>) {
  const elOwner = document.querySelector(OWNER_SELECTOR);
  if (!elOwner || !isPolymerElement(elOwner)) {
    return;
  }

  const ownerData = ownerDataSchema.safeParse(elOwner.data);
  const freshText = textFromInnerTubeText(subscriberCountText);
  const isCountChanged = ownerData.success
    && freshText !== ""
    && textFromInnerTubeText(ownerData.data.subscriberCountText) !== freshText;
  if (!isCountChanged) {
    return;
  }

  elOwner.set("data.subscriberCountText", subscriberCountText);
  const elCount = elOwner.querySelector<HTMLElement>(OWNER_SUBSCRIBER_COUNT_SELECTOR);
  if (elCount) {
    triggerAnimation({
      elTarget: elCount,
      animationClass: "ytaf-updated"
    });
  }
}
