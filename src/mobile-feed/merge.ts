import type { Prettify } from "@/subscription-feed/types/prettify";
import { textFromInnerTubeText } from "@/subscription-feed/youtube-api/renderer-fields";

import type { MobileGridItem } from "./schemas";

const VIDEO_ID_PATTERN = /"videoId":"([^"]+)"/g;

// A section (a Shorts shelf, say) is known by the videos it holds.
function itemKey(item: Prettify<MobileGridItem>) {
  const videoId = item.richItemRenderer?.content?.videoWithContextRenderer?.videoId;
  if (videoId) {
    return videoId;
  }

  const sectionVideoIds = new Set([...JSON.stringify(item).matchAll(VIDEO_ID_PATTERN)].map(match => match[1]));
  return [...sectionVideoIds].join();
}

// Only what the tile shows: the rest of a renderer (tracking tokens, signed image queries) differs on
// every response and would repaint every tile on every poll.
function itemSignature(item: Prettify<MobileGridItem>) {
  const video = item.richItemRenderer?.content?.videoWithContextRenderer;
  if (!video) {
    return itemKey(item);
  }

  const { headline, shortViewCountText, publishedTimeText, lengthText, thumbnail, thumbnailOverlays } = video;
  return JSON.stringify([
    video.videoId,
    ...[headline, shortViewCountText, publishedTimeText, lengthText].map(textFromInnerTubeText),
    thumbnail?.thumbnails[0]?.url.split("?")[0],
    thumbnailOverlays?.map(overlay => overlay.thumbnailOverlayTimeStatusRenderer?.style)
  ]);
}

type MergeFeedParams = Prettify<{
  current: MobileGridItem[];
  fresh: MobileGridItem[];
}>;

// The response holds the first page only. Videos past it were loaded by scrolling and stay, an
// unchanged tile keeps its object so it is not repainted, and null means nothing is to be done.
export function mergeFeed({ current, fresh }: MergeFeedParams) {
  const currentVideos = current.filter(item => !item.continuationItemRenderer);
  const freshVideos = fresh.filter(item => !item.continuationItemRenderer);
  const freshKeys = new Set(freshVideos.map(itemKey));
  const iLastShared = currentVideos.findLastIndex(item => freshKeys.has(itemKey(item)));
  // With nothing in common there is no telling where the loaded videos belong
  if (iLastShared < 0) {
    return null;
  }

  const currentByKey = new Map(currentVideos.map(item => [itemKey(item), item]));
  const firstPage = freshVideos.map(item => {
    const shown = currentByKey.get(itemKey(item));
    return shown && itemSignature(shown) === itemSignature(item) ? shown : item;
  });
  const isScrolledFurther = currentVideos.length > freshVideos.length;
  const scrolled = isScrolledFurther
    ? currentVideos.slice(iLastShared + 1).filter(item => !freshKeys.has(itemKey(item)))
    : [];
  const merged = [...firstPage, ...scrolled];
  const isUnchanged = merged.length === currentVideos.length && merged.every((item, i) => item === currentVideos[i]);
  if (isUnchanged) {
    return null;
  }

  const continuation = [current, fresh].flatMap(items => items.filter(item => item.continuationItemRenderer))[0];
  return continuation ? [...merged, continuation] : merged;
}
