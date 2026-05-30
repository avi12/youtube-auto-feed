import type { InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel } from "./innertube";
import type { Prettify } from "./prettify";

// VideoSnapshot is the extension's internal representation of a feed video. It's normalized across
// all of YouTube's renderer shapes (videoRenderer / lockupViewModel / shortsLockupViewModel) so
// diffing and DOM updates can work on a single shape, while still keeping the original renderer
// around (`rawRenderer`) so we can re-insert it through Polymer when needed.

export enum VideoStatus {
  Video = "video",
  Upcoming = "upcoming",
  Live = "live",
  Short = "short"
}

export interface VideoSnapshot {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  status: VideoStatus;
  viewCountText: string;
  publishedTimeText: string;
  isChannelLive: boolean;
  watchProgressPercent: number | null;
  // "" = Latest band (inline grid). Anything else = a named shelf like "Shorts" or "Most relevant".
  sectionTitle: string;
  // Positional band the video appeared in. 0 = Latest. Used to detect cross-band moves.
  bandIndex: number;
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>;
}
