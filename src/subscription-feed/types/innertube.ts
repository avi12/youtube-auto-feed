// Public InnerTube payload type surface. The video-renderer shapes live in ./innertube-renderers,
// the shelf/grid/browse envelopes in ./innertube-shelves, and the `ytcfg` client config (with its
// ambient `declare global`) in ./innertube-client. All are re-exported here so importers stay unchanged.

import "./innertube-client";

export type {
  ChannelVideoPlayerRenderer,
  ImageSource,
  InnerTubeVideoRenderer,
  LockupViewModel,
  ShortsLockupViewModel
} from "./innertube-renderers";

export {
  BadgeStyle,
  LockupBadgeStyle,
  LockupContentType,
  OverlayStyle
} from "./innertube-renderers";

export type {
  InnerTubeBrowseResponse,
  InnerTubeRichGridItem,
  InnerTubeRichItemContent,
  InnerTubeRichShelfRenderer,
  InnerTubeShelfRenderer
} from "./innertube-shelves";
