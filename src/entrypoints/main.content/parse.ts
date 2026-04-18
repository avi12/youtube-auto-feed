import { isRecord } from "./helpers";
import {
  BadgeStyle,
  type InnerTubeBrowseResponse,
  type InnerTubeVideoRenderer,
  LockupBadgeStyle,
  LockupContentType,
  type LockupViewModel,
  OverlayStyle,
  type ShortsLockupViewModel,
  type VideoSnapshot,
  VideoStatus
} from "./types";

export function isVideoRenderer(value: unknown): value is InnerTubeVideoRenderer {
  return isRecord(value) && typeof value.videoId === "string";
}

export function isLockupViewModel(value: unknown): value is LockupViewModel {
  return isRecord(value) && typeof value.contentId === "string";
}

export function isShortsLockupViewModel(value: unknown): value is ShortsLockupViewModel {
  return isRecord(value) && isRecord(value.onTap);
}

export function isInnerTubeBrowseResponse(value: unknown): value is InnerTubeBrowseResponse {
  return isRecord(value) && isRecord(value.contents);
}

function viewCountFromRenderer(renderer: InnerTubeVideoRenderer) {
  const {
    viewCountText,
    shortViewCountText
  } = renderer;
  return viewCountText?.simpleText
    ?? viewCountText?.runs?.map(({ text }) => text).join("")
    ?? shortViewCountText?.simpleText
    ?? "";
}

function statusFromRenderer(renderer: InnerTubeVideoRenderer) {
  const {
    badges,
    thumbnailOverlays,
    navigationEndpoint
  } = renderer;
  const badgeStyle = badges
    ?.find(badge => badge.metadataBadgeRenderer)
    ?.metadataBadgeRenderer?.style;
  const overlayStyle = thumbnailOverlays
    ?.find(overlay => overlay.thumbnailOverlayTimeStatusRenderer)
    ?.thumbnailOverlayTimeStatusRenderer?.style;
  if (badgeStyle === BadgeStyle.LiveNow || overlayStyle === OverlayStyle.Live) {
    return VideoStatus.Live;
  }

  if (badgeStyle === BadgeStyle.Upcoming || overlayStyle === OverlayStyle.Upcoming) {
    return VideoStatus.Upcoming;
  }

  if (navigationEndpoint?.reelWatchEndpoint !== undefined) {
    return VideoStatus.Short;
  }

  return VideoStatus.Video;
}

export function parseRenderer(renderer: InnerTubeVideoRenderer, sectionTitle: string) {
  const {
    videoId,
    title,
    thumbnail,
    publishedTimeText
  } = renderer;
  if (videoId === "") {
    return null;
  }

  return {
    videoId,
    title: title.runs?.[0]?.text ?? title.simpleText ?? "",
    thumbnailUrl: thumbnail.thumbnails.at(-1)?.url ?? "",
    status: statusFromRenderer(renderer),
    viewCountText: viewCountFromRenderer(renderer),
    publishedTimeText: publishedTimeText?.simpleText ?? "",
    isChannelLive: false,
    sectionTitle,
    rawRenderer: renderer
  } satisfies VideoSnapshot;
}

function statusFromLockup(lockup: LockupViewModel) {
  if (lockup.contentType === LockupContentType.Shorts) return VideoStatus.Short;
  const overlays = lockup.contentImage?.thumbnailViewModel?.overlays ?? [];
  for (const overlay of overlays) {
    for (const badge of overlay.thumbnailBottomOverlayViewModel?.badges ?? []) {
      const style = badge.thumbnailBadgeViewModel?.badgeStyle;
      if (style === LockupBadgeStyle.Live) return VideoStatus.Live;
      if (style === LockupBadgeStyle.Upcoming) return VideoStatus.Upcoming;
    }
  }
  return VideoStatus.Video;
}

export function parseLockupViewModel(lockup: LockupViewModel, sectionTitle: string) {
  const {
    contentId,
    contentImage,
    contentType,
    metadata
  } = lockup;
  if (contentId === "") {
    return null;
  }

  const metaViewModel = metadata?.lockupMetadataViewModel;
  const title = metaViewModel?.title?.content ?? "";
  const sources = contentImage?.thumbnailViewModel?.image?.sources;
  const thumbnailUrl = sources?.at(-1)?.url ?? "";
  const metaRows = metaViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
  const metaParts = metaRows?.[1]?.metadataParts;
  const viewCountText = metaParts?.[0]?.text?.content ?? "";
  const publishedTimeText = metaParts?.[1]?.text?.content ?? "";
  const status = statusFromLockup(lockup);
  const isChannelLive = !!metaViewModel?.image?.decoratedAvatarViewModel?.liveData?.liveBadgeText;
  return {
    videoId: contentId,
    title,
    thumbnailUrl,
    status,
    viewCountText,
    publishedTimeText,
    isChannelLive,
    sectionTitle,
    rawRenderer: lockup
  } satisfies VideoSnapshot;
}

export function parseShortsLockupViewModel(shortsLockup: ShortsLockupViewModel, sectionTitle: string) {
  const videoId = shortsLockup.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? "";
  if (videoId === "") {
    return null;
  }

  const title = shortsLockup.overlayMetadata?.primaryText?.content ?? shortsLockup.accessibilityText ?? "";
  const thumbnailUrl = shortsLockup.thumbnail?.sources?.at(-1)?.url ?? "";
  const viewCountText = shortsLockup.overlayMetadata?.secondaryText?.content ?? "";
  return {
    videoId,
    title,
    thumbnailUrl,
    status: VideoStatus.Short,
    viewCountText,
    publishedTimeText: "",
    isChannelLive: false,
    sectionTitle,
    rawRenderer: shortsLockup
  } satisfies VideoSnapshot;
}

export function parseSecondsAgo(publishedTimeText: string) {
  const match = publishedTimeText.match(/(\d+)\s+(second|minute|hour|day|week|month|year)/);
  if (!match) {
    return 0;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const secondsPerUnit: Record<string, number> = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000
  };
  return value * (secondsPerUnit[unit] ?? 0);
}

function collectSnapshot(
  sectionTitle: string,
  snapshots: VideoSnapshot[],
  seenVideoIds: Set<string>,
  renderer?: InnerTubeVideoRenderer,
  lockup?: LockupViewModel,
  shortsLockup?: ShortsLockupViewModel
) {
  let snapshot = null;
  if (renderer) {
    snapshot = parseRenderer(renderer, sectionTitle);
  } else if (lockup) {
    snapshot = parseLockupViewModel(lockup, sectionTitle);
  } else if (shortsLockup) {
    snapshot = parseShortsLockupViewModel(shortsLockup, sectionTitle);
  }

  if (snapshot && !seenVideoIds.has(snapshot.videoId)) {
    seenVideoIds.add(snapshot.videoId);
    snapshots.push(snapshot);
  }
}

export function parseApiResponse(data: InnerTubeBrowseResponse) {
  const snapshots: VideoSnapshot[] = [];
  const seenVideoIds = new Set<string>();
  try {
    const tabContent = data.contents.twoColumnBrowseResultsRenderer.tabs[0]?.tabRenderer.content;

    const pushSnapshot = (sectionTitle: string, renderer?: InnerTubeVideoRenderer, lockup?: LockupViewModel, shortsLockup?: ShortsLockupViewModel) =>
      collectSnapshot(sectionTitle, snapshots, seenVideoIds, renderer, lockup, shortsLockup);

    let currentSectionTitle = "";
    for (const item of tabContent?.richGridRenderer?.contents ?? []) {
      if (item.richSectionRenderer) {
        const { richShelfRenderer, shelfRenderer } = item.richSectionRenderer.content;
        if (richShelfRenderer) {
          currentSectionTitle = richShelfRenderer.title.runs[0]?.text ?? "";
          for (const richItem of richShelfRenderer.contents) {
            const content = richItem.richItemRenderer?.content;
            pushSnapshot(currentSectionTitle, content?.videoRenderer ?? content?.gridVideoRenderer, content?.lockupViewModel, content?.shortsLockupViewModel);
          }
        } else if (shelfRenderer) {
          currentSectionTitle = shelfRenderer.title.runs[0]?.text ?? "";
          const shelfItems = shelfRenderer.content?.horizontalListRenderer?.items ?? shelfRenderer.content?.gridRenderer?.items ?? [];
          for (const shelfItem of shelfItems) {
            pushSnapshot(currentSectionTitle, shelfItem.videoRenderer ?? shelfItem.gridVideoRenderer);
          }
        }
        currentSectionTitle = "";
      } else if (item.richItemRenderer) {
        const { content } = item.richItemRenderer;
        pushSnapshot(currentSectionTitle, content?.videoRenderer ?? content?.gridVideoRenderer, content?.lockupViewModel, content?.shortsLockupViewModel);
      }
    }

    if (snapshots.length === 0) {
      for (const sectionItem of tabContent?.sectionListRenderer?.contents ?? []) {
        for (const innerItem of sectionItem.itemSectionRenderer?.contents ?? []) {
          const shelf = innerItem.shelfRenderer;
          if (!shelf) {
            continue;
          }

          const sectionTitle = shelf.title.runs[0]?.text ?? "";
          const shelfItems = shelf.content?.horizontalListRenderer?.items ?? shelf.content?.gridRenderer?.items ?? [];
          for (const shelfItem of shelfItems) {
            pushSnapshot(sectionTitle, shelfItem.videoRenderer ?? shelfItem.gridVideoRenderer);
          }
        }
      }
    }
  } catch {}
  return snapshots;
}
