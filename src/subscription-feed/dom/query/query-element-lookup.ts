import { RICH_ITEM_SELECTOR } from "@/subscription-feed/dom/mirror/mirror-constants";
import type { PolymerElement } from "@/subscription-feed/types/polymer";
import type { Prettify } from "@/subscription-feed/types/prettify";
import { videoIdFromData } from "@/subscription-feed/utils/video-id";
import { isVideoRenderer } from "@/subscription-feed/youtube-api/guards";

type ElementMatchesVideoIdParams = Prettify<{
  elItem: PolymerElement;
  videoId: string;
}>;

function elementMatchesVideoId({ elItem, videoId }: ElementMatchesVideoIdParams) {
  if (elItem.tagName === "YTD-RICH-ITEM-RENDERER") {
    return videoIdFromData(elItem.data) === videoId;
  }

  const gridVideoData = elItem.data;
  return isVideoRenderer(gridVideoData) && gridVideoData.videoId === videoId;
}

export function findItemElements(videoId: string) {
  const elRichItems = document.querySelectorAll<PolymerElement>(RICH_ITEM_SELECTOR);
  const elGridVideos = document.querySelectorAll<PolymerElement>("ytd-grid-video-renderer");
  return [...elRichItems, ...elGridVideos].filter(elItem =>
    elementMatchesVideoId({
      elItem,
      videoId
    })
  );
}
