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

const VIEW_COUNT_TEXT_PATTERN = /view|watching|waiting/i;

// A metadata row with two items is always "<view count> · <published time>". A lone item is the view
// count only when it reads like one (a live "watching"/"waiting" count, or "No views"); otherwise it
// is the published time, as on members-only videos that hide their count and show just the date. This
// keeps a date from ever being written into the view-count slot, and lets a real count show + update.
function splitLockupMetadata(firstPart: string, secondPart: string) {
  if (secondPart !== "") {
    return {
      viewCountText: firstPart,
      publishedTimeText: secondPart
    };
  }

  if (VIEW_COUNT_TEXT_PATTERN.test(firstPart)) {
    return {
      viewCountText: firstPart,
      publishedTimeText: ""
    };
  }

  return {
    viewCountText: "",
    publishedTimeText: firstPart
  };
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
  // The subscriptions feed prefixes a channel-name row, putting view-count/published-time in row 1;
  // a channel page omits that row, so it lands in row 0. Pick the row that carries both (2 parts),
  // else the last populated row (members-only/live/upcoming videos show a single metadata item).
  const metadataRows = metaViewModel?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
  const reversedRows = [...metadataRows].reverse();
  const { metadataParts } = reversedRows.find(row => (row.metadataParts?.length ?? 0) >= 2)
    ?? reversedRows.find(row => (row.metadataParts?.length ?? 0) >= 1)
    ?? {};
  const { viewCountText, publishedTimeText } = splitLockupMetadata(
    metadataParts?.[0]?.text?.content ?? "",
    metadataParts?.[1]?.text?.content ?? ""
  );
  return {
    videoId: contentId,
    title: metaViewModel?.title?.content ?? "",
    thumbnailUrl,
    status: statusFromLockup(lockup),
    viewCountText,
    publishedTimeText,
    isChannelLive: !!metaViewModel?.image?.decoratedAvatarViewModel?.liveData?.liveBadgeText,
    watchProgressPercent: watchProgressFromLockup(lockup),
    sectionTitle,
    bandIndex,
    rawRenderer: lockup
  } satisfies VideoSnapshot;
}
