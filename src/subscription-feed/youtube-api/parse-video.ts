import type { ChannelVideoPlayerRenderer, InnerTubeVideoRenderer, ShortsLockupViewModel } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import { type VideoSnapshot, VideoStatus } from "../types/video";
import { statusFromRenderer, thumbnailUrlFromShortsLockup, viewCountFromRenderer } from "./guards";
import type { ParseVideoParams } from "./parse-video-params";

type ParseRendererParams = Prettify<ParseVideoParams & { renderer: Prettify<InnerTubeVideoRenderer> }>;

export function parseRenderer({ renderer, sectionTitle, bandIndex }: ParseRendererParams) {
  const {
    videoId, title, thumbnail, publishedTimeText
  } = renderer;
  if (videoId === "") {
    return null;
  }

  const { runs, simpleText } = title;
  return {
    videoId,
    title: runs?.[0]?.text ?? simpleText ?? "",
    thumbnailUrl: thumbnail.thumbnails.at(-1)?.url ?? "",
    status: statusFromRenderer(renderer),
    viewCountText: viewCountFromRenderer(renderer),
    publishedTimeText: publishedTimeText?.simpleText ?? "",
    isChannelLive: false,
    watchProgressPercent: null,
    sectionTitle,
    bandIndex,
    rawRenderer: renderer
  } satisfies VideoSnapshot;
}

type ParseShortsLockupViewModelParams = Prettify<ParseVideoParams & { shortsLockup: Prettify<ShortsLockupViewModel> }>;

export function parseShortsLockupViewModel(
  { shortsLockup, sectionTitle, bandIndex }: ParseShortsLockupViewModelParams
) {
  const { onTap, overlayMetadata, accessibilityText = "" } = shortsLockup;
  const { videoId = "" } = onTap?.innertubeCommand?.reelWatchEndpoint ?? {};
  if (videoId === "") {
    return null;
  }

  const { primaryText, secondaryText } = overlayMetadata ?? {};
  return {
    videoId,
    title: primaryText?.content ?? accessibilityText,
    thumbnailUrl: thumbnailUrlFromShortsLockup(shortsLockup),
    status: VideoStatus.Short,
    viewCountText: secondaryText?.content ?? "",
    publishedTimeText: "",
    isChannelLive: false,
    watchProgressPercent: null,
    sectionTitle,
    bandIndex,
    rawRenderer: shortsLockup
  } satisfies VideoSnapshot;
}

// The channel-page trailer/featured video: an inline player with its own title/views/date metadata.
export function parseChannelVideoPlayer(trailer: Prettify<ChannelVideoPlayerRenderer>) {
  const { videoId, title, viewCountText, publishedTimeText } = trailer;
  if (videoId === "") {
    return null;
  }

  return {
    videoId,
    title: title?.runs?.[0]?.text ?? title?.simpleText ?? "",
    thumbnailUrl: "",
    status: VideoStatus.Video,
    viewCountText: viewCountText?.simpleText ?? viewCountText?.runs?.[0]?.text ?? "",
    publishedTimeText: publishedTimeText?.runs?.[0]?.text ?? publishedTimeText?.simpleText ?? "",
    isChannelLive: false,
    watchProgressPercent: null,
    sectionTitle: "",
    bandIndex: 0,
    // The trailer patches its own text nodes in place and never goes through the renderer-rebuild
    // path, so rawRenderer only needs to be a valid renderer carrying the id and title.
    rawRenderer: {
      videoId,
      title: title ?? {},
      thumbnail: {
        thumbnails: []
      }
    }
  } satisfies VideoSnapshot;
}

export { parseLockupViewModel } from "./parse-lockup";
