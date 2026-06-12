import type { LockupViewModel } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";
import { statusFromLockup } from "./guards";
import type { ParseVideoParams } from "./parse-video-params";

function watchProgressFromLockup(lockup: Prettify<LockupViewModel>): number | null {
  for (const overlay of lockup.contentImage?.thumbnailViewModel?.overlays ?? []) {
    const progress = overlay.thumbnailBottomOverlayViewModel?.progressBar?.thumbnailOverlayProgressBarViewModel;
    if (typeof progress?.startPercent === "number") {
      return progress.startPercent;
    }
  }
  return null;
}

type ParseLockupViewModelParams = Prettify<ParseVideoParams & { lockup: Prettify<LockupViewModel> }>;

export function parseLockupViewModel({ lockup, sectionTitle, bandIndex }: ParseLockupViewModelParams) {
  const { contentId, contentImage, metadata } = lockup;
  if (contentId === "") {
    return null;
  }

  const metaViewModel = metadata?.lockupMetadataViewModel;
  // Keep the query string: an edited thumbnail reuses the /vi/{id}/ path and only rotates sqp/rs.
  const thumbnailUrl = contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url ?? "";
  const metaParts = metaViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[1]?.metadataParts;
  return {
    videoId: contentId,
    title: metaViewModel?.title?.content ?? "",
    thumbnailUrl,
    status: statusFromLockup(lockup),
    viewCountText: metaParts?.[0]?.text?.content ?? "",
    publishedTimeText: metaParts?.[1]?.text?.content ?? "",
    isChannelLive: !!metaViewModel?.image?.decoratedAvatarViewModel?.liveData?.liveBadgeText,
    watchProgressPercent: watchProgressFromLockup(lockup),
    sectionTitle,
    bandIndex,
    rawRenderer: lockup
  } satisfies VideoSnapshot;
}
