// Raw types describing YouTube's InnerTube API payloads (the `/youtubei/v1/browse` response shape).
// These types are intentionally permissive: YouTube's response is a tagged union where every renderer
// is optional, so callers must check presence/use guards rather than assuming a field exists.

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

// lockupViewModel is YouTube's newer renderer format (used for regular videos in the new UI).
export enum LockupContentType {
  Shorts = "LOCKUP_CONTENT_TYPE_SHORTS"
}

export enum LockupBadgeStyle {
  Live = "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE",
  Upcoming = "THUMBNAIL_OVERLAY_BADGE_STYLE_UPCOMING"
}

export interface LockupViewModel {
  contentId: string;
  contentType: LockupContentType;
  contentImage?: {
    thumbnailViewModel?: {
      image?: {
        sources?: Array<{
          url: string;
          width?: number;
          height?: number;
        }>;
      };
      overlays?: Array<{
        thumbnailBottomOverlayViewModel?: {
          badges?: Array<{
            thumbnailBadgeViewModel?: {
              badgeStyle?: LockupBadgeStyle;
              text?: string;
            };
          }>;
          progressBar?: {
            thumbnailOverlayProgressBarViewModel?: { startPercent?: number };
          };
        };
      }>;
    };
  };
  metadata?: {
    lockupMetadataViewModel?: {
      title?: { content?: string };
      metadata?: {
        contentMetadataViewModel?: { metadataRows?: Array<{ metadataParts?: Array<{
          text?: { content?: string };
        }>; }>; };
      };
      image?: {
        decoratedAvatarViewModel?: {
          liveData?: { liveBadgeText?: string };
        };
      };
    };
  };
}

// shortsLockupViewModel is the renderer used inside the "Shorts" rich shelf in the subscriptions feed.
export interface ShortsLockupViewModel {
  entityId?: string;
  accessibilityText?: string;
  onTap?: {
    innertubeCommand?: {
      reelWatchEndpoint?: { videoId: string };
    };
  };
  overlayMetadata?: {
    primaryText?: { content?: string };
    secondaryText?: { content?: string };
  };
  thumbnail?: { sources?: Array<{
    url: string;
    width?: number;
    height?: number;
  }>; };
}

// Shelf / grid renderer envelopes that contain one or more of the video renderer variants above.

export interface InnerTubeRichItemContent {
  videoRenderer?: InnerTubeVideoRenderer;
  gridVideoRenderer?: InnerTubeVideoRenderer;
  richGridMediaRenderer?: {
    content?: { videoRenderer?: InnerTubeVideoRenderer };
  };
  lockupViewModel?: LockupViewModel;
  shortsLockupViewModel?: ShortsLockupViewModel;
}

export interface InnerTubeRichShelfRenderer {
  title: { runs: Array<{ text: string }> };
  contents: Array<{
    richItemRenderer?: { content: InnerTubeRichItemContent };
  }>;
}

export interface InnerTubeShelfRenderer {
  title: { runs: Array<{ text: string }> };
  content: {
    horizontalListRenderer?: {
      items: Array<{
        videoRenderer?: InnerTubeVideoRenderer;
        gridVideoRenderer?: InnerTubeVideoRenderer;
      }>;
    };
    gridRenderer?: {
      items: Array<{
        videoRenderer?: InnerTubeVideoRenderer;
        gridVideoRenderer?: InnerTubeVideoRenderer;
      }>;
    };
  };
}

export interface InnerTubeContinuationItem {
  trigger: string;
  continuationEndpoint: {
    clickTrackingParams: string;
    commandMetadata?: {
      webCommandMetadata?: {
        sendPost?: boolean;
        apiUrl?: string;
      };
    };
    continuationCommand: {
      token: string;
      request: string;
    };
  };
  ghostCards?: {
    ghostGridRenderer?: { rows: number };
  };
}

export interface InnerTubeRichGridItem {
  richSectionRenderer?: {
    content: {
      richShelfRenderer?: InnerTubeRichShelfRenderer;
      shelfRenderer?: InnerTubeShelfRenderer;
    };
    trackingParams?: string;
  };
  richItemRenderer?: {
    content: InnerTubeRichItemContent;
    trackingParams?: string;
    onFocusEffect?: unknown;
    rowIndex?: number;
    colIndex?: number;
  };
  continuationItemRenderer?: InnerTubeContinuationItem;
}

export interface InnerTubeBrowseResponse {
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: Array<{
        tabRenderer: {
          content: {
            richGridRenderer?: { contents: InnerTubeRichGridItem[] };
            sectionListRenderer?: { contents: Array<{
              itemSectionRenderer?: { contents: Array<{ shelfRenderer?: InnerTubeShelfRenderer }> };
            }>; };
          };
        };
      }>;
    };
  };
}

// YouTube's InnerTube client config (exposed on `ytcfg` for content scripts running in the page's MAIN world).

type InnerTubeClientName =
  | "WEB"
  | "MWEB"
  | "ANDROID"
  | "IOS"
  | "TVHTML5"
  | "TV_UNPLUGGED"
  | "WEB_EMBEDDED_PLAYER"
  | "WEB_CREATOR";

type InnerTubePlatform = "DESKTOP" | "MOBILE" | "TV";

type InnerTubeClientFormFactor =
  | "UNKNOWN_FORM_FACTOR"
  | "SMALL_FORM_FACTOR"
  | "LARGE_FORM_FACTOR"
  | "AUTOMOTIVE_FORM_FACTOR";

type InnerTubeUserInterfaceTheme =
  | "USER_INTERFACE_THEME_DARK"
  | "USER_INTERFACE_THEME_LIGHT";

interface InnerTubeContext {
  client: {
    clientName: InnerTubeClientName;
    clientVersion: string;
    hl?: string;
    gl?: string;
    remoteHost?: string;
    deviceMake?: string;
    deviceModel?: string;
    visitorData?: string;
    userAgent?: string;
    osName?: string;
    osVersion?: string;
    originalUrl?: string;
    platform?: InnerTubePlatform;
    clientFormFactor?: InnerTubeClientFormFactor;
    windowWidthPoints?: number;
    configInfo?: { appInstallData?: string };
    screenDensityFloat?: number;
    userInterfaceTheme?: InnerTubeUserInterfaceTheme;
    timeZone?: string;
    browserName?: string;
    browserVersion?: string;
    memoryTotalKbytes?: number;
    acceptHeader?: string;
    deviceExperimentId?: string;
    rolloutToken?: string;
  };
  user?: { lockedSafetyMode?: boolean };
  request?: { useSsl?: boolean };
  clickTracking?: { clickTrackingParams?: string };
}

interface YouTubeInnertubeConfig {
  INNERTUBE_CLIENT_VERSION?: string;
  INNERTUBE_CONTEXT?: InnerTubeContext;
  INNERTUBE_API_KEY?: string;
  HL?: string;
  GL?: string;
}

declare global {
  const ytcfg: { get<K extends keyof YouTubeInnertubeConfig>(key: K): YouTubeInnertubeConfig[K] } | undefined;
}
