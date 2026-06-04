import type { InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import { type VideoSnapshot, VideoStatus } from "../types/video";
import { statusFromLockup, statusFromRenderer, viewCountFromRenderer } from "./guards";

// These three parsers each normalize one of YouTube's renderer shapes into a single VideoSnapshot
// the rest of the extension can work with. Anything they can't parse (missing videoId) is dropped.

interface ParseVideoParams {
  sectionTitle: string;
  bandIndex: number;
}

function watchProgressFromLockup(lockup: Prettify<LockupViewModel>): number | null {
  for (const overlay of lockup.contentImage?.thumbnailViewModel?.overlays ?? []) {
    const progress = overlay.thumbnailBottomOverlayViewModel?.progressBar?.thumbnailOverlayProgressBarViewModel;
    if (typeof progress?.startPercent === "number") {
      return progress.startPercent;
    }
  }
  return null;
}

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
    thumbnailUrl: thumbnail.thumbnails.at(-1)?.url.split("?")[0] ?? "",
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

type ParseLockupViewModelParams = Prettify<ParseVideoParams & { lockup: Prettify<LockupViewModel> }>;

export function parseLockupViewModel({ lockup, sectionTitle, bandIndex }: ParseLockupViewModelParams) {
  const { contentId, contentImage, metadata } = lockup;
  if (contentId === "") {
    return null;
  }

  const metaViewModel = metadata?.lockupMetadataViewModel;
  const title = metaViewModel?.title?.content ?? "";
  const sources = contentImage?.thumbnailViewModel?.image?.sources;
  const thumbnailUrl = sources?.at(-1)?.url.split("?")[0] ?? "";
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
    watchProgressPercent: watchProgressFromLockup(lockup),
    sectionTitle,
    bandIndex,
    rawRenderer: lockup
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
  const thumbnailUrl = thumbnail?.sources?.at(-1)?.url.split("?")[0] ?? "";
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
