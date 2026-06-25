import type { Prettify } from "../../types/prettify";
import type { VideoSnapshot } from "../../types/video";
import { isPolymerElement } from "../../utils/polymer";
import { isChannelVideoPlayerRenderer, isVideoRenderer } from "../../youtube-api/guards";
import { parseChannelVideoPlayer, parseRenderer } from "../../youtube-api/parse-video";
import { addRichItemToSnapshot } from "./query-snapshot-parse";

// Reads the metadata each video tile currently shows, document-wide and page-agnostic (grid lockups,
// legacy grid videos, the channel trailer). The page-agnostic metadata updater diffs fresh page data
// against this so it only patches tiles whose displayed metadata has actually drifted.
export function readGenericDomSnapshot() {
  const snapshot = new Map<string, Prettify<VideoSnapshot>>();

  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-rich-item-renderer")) {
    addRichItemToSnapshot({
      elItem,
      sectionTitle: "",
      bandIndex: 0,
      snapshot
    });
  }

  for (const elItem of document.querySelectorAll<HTMLElement>("ytd-grid-video-renderer")) {
    if (!isPolymerElement(elItem) || !isVideoRenderer(elItem.data)) {
      continue;
    }

    const parsed = parseRenderer({
      renderer: elItem.data,
      sectionTitle: "",
      bandIndex: 0
    });
    if (parsed && !snapshot.has(parsed.videoId)) {
      snapshot.set(parsed.videoId, parsed);
    }
  }

  for (const elTrailer of document.querySelectorAll<HTMLElement>("ytd-channel-video-player-renderer")) {
    if (!isPolymerElement(elTrailer) || !isChannelVideoPlayerRenderer(elTrailer.data)) {
      continue;
    }

    const parsed = parseChannelVideoPlayer(elTrailer.data);
    if (parsed && !snapshot.has(parsed.videoId)) {
      snapshot.set(parsed.videoId, parsed);
    }
  }

  return snapshot;
}
