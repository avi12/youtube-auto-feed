import type { Prettify } from "@/subscription-feed/types/prettify";
import type { VideoSnapshot } from "@/subscription-feed/types/video";
import { collectLegacyShelfVideos, collectRichShelfVideos } from "./query-snapshot-collectors";
import { collectFallbackGridVideos, collectInlineGridVideos } from "./query-snapshot-grid-collectors";

export function readDomSnapshot() {
  const snapshot = new Map<string, Prettify<VideoSnapshot>>();

  collectRichShelfVideos(snapshot);
  collectLegacyShelfVideos(snapshot);
  collectInlineGridVideos(snapshot);

  const isRichGridLayoutPresent = snapshot.size > 0;
  if (!isRichGridLayoutPresent) {
    collectFallbackGridVideos(snapshot);
  }

  return snapshot;
}
