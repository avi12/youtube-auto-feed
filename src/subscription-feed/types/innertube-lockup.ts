// Newer renderer format for regular videos, plus the shortsLockupViewModel inside the Shorts shelf.

export enum LockupContentType {
  Shorts = "LOCKUP_CONTENT_TYPE_SHORTS"
}

export enum LockupBadgeStyle {
  Live = "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE",
  Upcoming = "THUMBNAIL_OVERLAY_BADGE_STYLE_UPCOMING",
  Special = "THUMBNAIL_OVERLAY_BADGE_STYLE_SPECIAL"
}

export enum LockupBadgePosition {
  TopStart = "THUMBNAIL_OVERLAY_BADGE_POSITION_TOP_START"
}

export interface LockupThumbnailBadge {
  thumbnailBadgeViewModel?: {
    badgeStyle?: LockupBadgeStyle;
    text?: string;
    rendererContext?: {
      accessibilityContext?: { label?: string };
    };
  };
}

// The duration and progress bar ride the bottom overlay; a corner marker like "New" is its own overlay
// with a position of its own.
export interface LockupThumbnailOverlay {
  thumbnailBottomOverlayViewModel?: {
    badges?: LockupThumbnailBadge[];
    progressBar?: {
      thumbnailOverlayProgressBarViewModel?: { startPercent?: number };
    };
  };
  thumbnailOverlayBadgeViewModel?: {
    thumbnailBadges?: LockupThumbnailBadge[];
    position?: LockupBadgePosition;
  };
}

export interface LockupViewModel {
  contentId: string;
  videoId?: string;
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
      overlays?: LockupThumbnailOverlay[];
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
          avatar?: {
            avatarViewModel?: {
              image?: {
                sources?: Array<{
                  url: string;
                  width?: number;
                  height?: number;
                }>;
              };
            };
          };
          liveData?: { liveBadgeText?: string };
        };
        // Collaborative videos use a stacked avatar; `avatars` has one entry per channel.
        avatarStackViewModel?: {
          avatars?: unknown[];
        };
      };
    };
  };
}

export interface ImageSource {
  url: string;
  width?: number;
  height?: number;
}

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
  thumbnail?: { sources?: ImageSource[] };
  thumbnailViewModel?: {
    thumbnailViewModel?: {
      image?: { sources?: ImageSource[] };
    };
  };
}
