import type { InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel } from "./innertube";

// Normalized internal representation of a feed video, unified across all renderer shapes.
// `rawRenderer` retains the original so it can be re-inserted through Polymer when needed.

export enum VideoStatus {
  Video = "video",
  Upcoming = "upcoming",
  Live = "live",
  Short = "short"
}

export interface MetadataPart {
  text: string;
  accessibilityLabel: string;
}

export interface VideoSnapshot {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  status: VideoStatus;
  viewCountText: string;
  publishedTimeText: string;
  // A lockup's metadata parts (channel, views, date, or whatever YouTube shows) in reading order,
  // mirrored without interpreting which part is which; empty for other renderer shapes.
  metadataParts: MetadataPart[];
  isChannelLive: boolean;
  watchProgressPercent: number | null;
  // "" = Latest band (inline grid); otherwise a named shelf ("Shorts", "Most relevant", etc.).
  sectionTitle: string;
  // Positional band index (0 = Latest). Used to detect cross-band moves.
  bandIndex: number;
  rawRenderer: InnerTubeVideoRenderer | LockupViewModel | ShortsLockupViewModel;
}
