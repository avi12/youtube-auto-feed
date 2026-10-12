// Public InnerTube payload type surface. The video-renderer shapes live in ./innertube-renderers,
// the shelf/grid/browse envelopes in ./innertube-shelves, the watch page's /next payload in
// ./innertube-watch, and the `ytcfg` client config (with its ambient `declare global`) in
// ./innertube-client. All are re-exported here so importers stay unchanged.

import "./innertube-client";

export type {
  ChannelVideoPlayerRenderer,
  ImageSource,
  InnerTubeText,
  InnerTubeVideoRenderer,
  LockupThumbnailBadge,
  LockupThumbnailOverlay,
  LockupViewModel,
  ShortsLockupViewModel
} from "./innertube-renderers";

export {
  BadgeStyle,
  LockupBadgePosition,
  LockupBadgeStyle,
  LockupContentType,
  OverlayStyle
} from "./innertube-renderers";

export type {
  EndScreenVideoRenderer,
  InnerTubeWatchNextResponse,
  WatchNextFeedItem
} from "./innertube-watch";

export type {
  InnerTubeGuideChannelEntry,
  InnerTubeGuideResponse
} from "./innertube-guide";

export type {
  InnerTubeBrowseResponse,
  InnerTubeRichGridItem,
  InnerTubeRichItemContent,
  InnerTubeRichShelfRenderer,
  InnerTubeShelfRenderer
} from "./innertube-shelves";
