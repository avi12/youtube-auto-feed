// Raw InnerTube video-renderer payload types; check presence via guards, never assume fields exist.

export interface InnerTubeThumbnail {
  url: string;
  width?: number;
  height?: number;
}

export enum BadgeStyle {
  LiveNow = "BADGE_STYLE_TYPE_LIVE_NOW",
  Upcoming = "BADGE_STYLE_TYPE_UPCOMING"
}

export interface InnerTubeMetadataBadge { metadataBadgeRenderer?: { style: BadgeStyle } }

export enum OverlayStyle {
  Live = "LIVE",
  Upcoming = "UPCOMING"
}

export interface InnerTubeThumbnailOverlay { thumbnailOverlayTimeStatusRenderer?: { style: OverlayStyle } }

export interface InnerTubeReelWatchEndpoint {
  videoId: string;
  playerParams?: string;
  params?: string;
  sequenceProvider?: string;
  sequenceParams?: string;
  ustreamerConfig?: string;
}

export interface InnerTubeUpcomingEventData {
  startTime?: string;
  isReminderSet?: boolean;
  upcomingEventText?: { runs?: Array<{ text: string }> };
}

interface InnerTubeText {
  runs?: Array<{ text: string }>;
  simpleText?: string;
}

// The channel-page trailer/featured video. Carries its own title/views/date next to an inline player.
export interface ChannelVideoPlayerRenderer {
  videoId: string;
  title?: InnerTubeText;
  viewCountText?: InnerTubeText;
  publishedTimeText?: InnerTubeText;
}

export interface InnerTubeVideoRenderer {
  videoId: string;
  title: {
    runs?: Array<{ text: string }>;
    simpleText?: string;
  };
  thumbnail: { thumbnails: InnerTubeThumbnail[] };
  badges?: InnerTubeMetadataBadge[];
  thumbnailOverlays?: InnerTubeThumbnailOverlay[];
  viewCountText?: {
    simpleText?: string;
    runs?: Array<{ text: string }>;
  };
  shortViewCountText?: { simpleText?: string };
  publishedTimeText?: { simpleText?: string };
  navigationEndpoint?: { reelWatchEndpoint?: InnerTubeReelWatchEndpoint };
  upcomingEventData?: InnerTubeUpcomingEventData;
}

export {
  type ImageSource,
  LockupBadgeStyle,
  LockupContentType,
  type LockupViewModel,
  type ShortsLockupViewModel
} from "./innertube-lockup";
