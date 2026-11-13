import type { PolymerElement } from "@/subscription-feed/types/polymer";
import type { Prettify } from "@/subscription-feed/types/prettify";
import type { VideoSnapshot } from "@/subscription-feed/types/video";
import { isVideoRenderer } from "@/subscription-feed/youtube-api/guards";
import { parseRenderer } from "@/subscription-feed/youtube-api/parse-video";

import { addRichItemToSnapshot } from "./query-snapshot-parse";

export function collectInlineGridVideos(snapshot: Map<string, Prettify<VideoSnapshot>>) {
  const elGridContents = document.querySelector("ytd-rich-grid-renderer > #contents");
  if (!elGridContents) {
    return;
  }

  let currentSectionTitle = "";
  let currentBandIndex = 0;
  for (const elChild of elGridContents.children) {
    if (elChild.tagName === "YTD-RICH-SECTION-RENDERER") {
      currentSectionTitle = "";
      const elInnerShelf = elChild.querySelector("ytd-shelf-renderer");
      const isInnerShelfPopulated =
        elInnerShelf !== null &&
        elInnerShelf.querySelectorAll("ytd-grid-video-renderer, ytd-video-renderer").length > 0;
      const isBandBoundary = elChild.querySelector("ytd-rich-shelf-renderer") !== null || isInnerShelfPopulated;
      if (isBandBoundary) {
        currentBandIndex++;
      }

      continue;
    }

    if (elChild.tagName === "YTD-RICH-ITEM-RENDERER") {
      addRichItemToSnapshot({
        elItem: elChild,
        sectionTitle: currentSectionTitle,
        bandIndex: currentBandIndex,
        snapshot
      });
    }
  }
}

export function collectFallbackGridVideos(snapshot: Map<string, Prettify<VideoSnapshot>>) {
  for (const elGridVideo of document.querySelectorAll<PolymerElement>("ytd-grid-video-renderer")) {
    const gridVideoData = elGridVideo.data;
    if (!isVideoRenderer(gridVideoData)) {
      continue;
    }

    const videoSnapshot = parseRenderer({
      renderer: gridVideoData,
      sectionTitle: "",
      bandIndex: 0
    });
    if (videoSnapshot) {
      snapshot.set(videoSnapshot.videoId, videoSnapshot);
    }
  }
}
