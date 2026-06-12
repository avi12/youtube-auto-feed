import type { PolymerElement } from "../../types/polymer";
import { videoIdFromData } from "../../utils/video-id";
import { isVideoRenderer } from "../../youtube-api/guards";

function elementMatchesVideoId(elItem: PolymerElement, videoId: string) {
  if (elItem.tagName === "YTD-RICH-ITEM-RENDERER") {
    return videoIdFromData(elItem.data) === videoId;
  }

  const gridVideoData = elItem.data;
  return isVideoRenderer(gridVideoData) && gridVideoData.videoId === videoId;
}

export function findItemElements(videoId: string) {
  const elRichItems = document.querySelectorAll<PolymerElement>("ytd-rich-item-renderer");
  const elGridVideos = document.querySelectorAll<PolymerElement>("ytd-grid-video-renderer");
  return [...elRichItems, ...elGridVideos].filter(elItem => elementMatchesVideoId(elItem, videoId));
}
