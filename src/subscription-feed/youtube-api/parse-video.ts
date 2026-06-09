import type { InnerTubeVideoRenderer, ShortsLockupViewModel } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import { type VideoSnapshot, VideoStatus } from "../types/video";
import { statusFromRenderer, viewCountFromRenderer } from "./guards";
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
  const { onTap, overlayMetadata, thumbnail, accessibilityText = "" } = shortsLockup;
  const videoId = onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? "";
  if (videoId === "") {
    return null;
  }

  const { primaryText, secondaryText } = overlayMetadata ?? {};
  const title = primaryText?.content ?? accessibilityText;
  const thumbnailUrl = thumbnail?.sources?.at(-1)?.url ?? "";
  const viewCountText = secondaryText?.content ?? "";
  return {
    videoId,
    title,
    thumbnailUrl,
    status: VideoStatus.Short,
    viewCountText,
    publishedTimeText: "",
    isChannelLive: false,
    watchProgressPercent: null,
    sectionTitle,
    bandIndex,
    rawRenderer: shortsLockup
  } satisfies VideoSnapshot;
}

export { parseLockupViewModel } from "./parse-lockup";
