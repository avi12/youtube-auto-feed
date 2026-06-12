import type { PolymerElement } from "../../types/polymer";
import type { Prettify } from "../../types/prettify";
import { videoIdFromData } from "../../utils/video-id";
import { isVideoRenderer } from "../../youtube-api/guards";

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
  const elRichItems = document.querySelectorAll<PolymerElement>("ytd-rich-item-renderer");
  const elGridVideos = document.querySelectorAll<PolymerElement>("ytd-grid-video-renderer");
  return [...elRichItems, ...elGridVideos].filter(elItem => elementMatchesVideoId({
    elItem,
    videoId
  }));
}
