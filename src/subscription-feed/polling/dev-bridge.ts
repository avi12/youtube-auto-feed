import { absenceCountByVideoId, GRID_ITEM_SELECTOR, type RichItemElement } from "../dom/mirror/mirror-constants";
import { thumbnailUrlFromContent } from "../dom/rich-item";
import { reconcileVisibleThumbnails } from "../dom/update/thumbnail-content-watch";
import { findThumbnailImgInItem } from "../dom/update/thumbnail-locate";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";
import { videoIdFromData } from "../utils/video-id";
import { type BlankReportEntry, startBlankThumbnailDetector } from "./blank-detector";
import type { MonitorContext, MonitorState } from "./polling-state";

// The dev server defines __YTAF_DEBUG__ true; a store build leaves it false, so this whole bridge and
// its only-here imports dead-code-strip out of the shipped extension.
declare const __YTAF_DEBUG__: boolean;

declare global {
  var __ytafDebug: YtafDebug | undefined;
}

interface VideoInspection {
  snapshot: Prettify<VideoSnapshot> | undefined;
  isInDom: boolean;
  dataUrl: string;
  paintedSrc: string | null;
  paintedWidth: number | null;
  isPaintedStale: boolean;
  contentHash: string | null;
  absenceCount: number;
}

interface YtafDebug {
  pausePolling: () => void;
  resumePolling: () => void;
  fetchFreshVideos: (isInitialLoad?: boolean) => Promise<boolean>;
  metadataPoll: () => Promise<void>;
  watchThumbnails: () => Promise<void>;
  snapshot: (videoId: string) => Prettify<VideoSnapshot> | undefined;
  inspect: (videoId: string) => VideoInspection;
  state: MonitorState;
  context: MonitorContext;
  absenceCountByVideoId: Map<string, number>;
  blankReport: () => BlankReportEntry[];
}

function findGridItem(videoId: string) {
  for (const elItem of document.querySelectorAll<RichItemElement>(GRID_ITEM_SELECTOR)) {
    if (videoIdFromData(elItem.data) === videoId) {
      return elItem;
    }
  }
  return null;
}

// One call to answer "why is this video's tile not what I expect": the diff's stored snapshot, the
// live grid data, the painted <img>, the content-watch hash, and the pagination-absence counter.
function inspectVideo(state: MonitorState, videoId: string): VideoInspection {
  const elItem = findGridItem(videoId);
  const dataUrl = elItem?.data.content ? thumbnailUrlFromContent(elItem.data.content) : "";
  const elImg = elItem ? findThumbnailImgInItem(elItem) : null;
  const paintedSrc = elImg?.getAttribute("src") ?? null;
  return {
    snapshot: state.lastSnapshot.get(videoId),
    isInDom: !!elItem,
    dataUrl,
    paintedSrc,
    paintedWidth: elImg?.naturalWidth ?? null,
    isPaintedStale: !!paintedSrc && paintedSrc.split("?")[0] !== dataUrl.split("?")[0],
    contentHash: state.thumbnailContentHashes.get(dataUrl) ?? null,
    absenceCount: absenceCountByVideoId.get(videoId) ?? 0
  };
}

export function installDevBridge(context: MonitorContext) {
  if (!__YTAF_DEBUG__) {
    return;
  }

  const { state } = context;
  const blankReport = startBlankThumbnailDetector();
  globalThis.__ytafDebug = {
    pausePolling: context.pausePolling,
    resumePolling: context.resumePolling,
    fetchFreshVideos: context.fetchFreshVideos,
    metadataPoll: context.fetchAndApplyMetadataUpdates,
    watchThumbnails: () => reconcileVisibleThumbnails({ contentHashes: state.thumbnailContentHashes }),
    snapshot: videoId => state.lastSnapshot.get(videoId),
    inspect: videoId => inspectVideo(state, videoId),
    state,
    context,
    absenceCountByVideoId,
    blankReport
  };
}
