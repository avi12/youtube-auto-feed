import type { InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel } from "../types/innertube";
import type { Prettify } from "../types/prettify";
import type { VideoSnapshot } from "../types/video";
import { isLockupViewModel, isShortsLockupViewModel } from "../youtube-api/guards";

// Build a richItemRenderer envelope around a raw renderer so it can be spliced into a Polymer
// `data.contents` array. The shape we produce is what YouTube's grid/shelf renderers expect.

function rawThumbnailUrl(
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>
) {
  if (isLockupViewModel(rawRenderer)) {
    return rawRenderer.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url ?? "";
  }

  if (isShortsLockupViewModel(rawRenderer)) {
    return rawRenderer.thumbnail?.sources?.at(-1)?.url ?? "";
  }

  return rawRenderer.thumbnail.thumbnails.at(-1)?.url ?? "";
}

export function preloadThumbnail(url: string) {
  return new Promise<void>(resolve => {
    if (!url) {
      resolve();
      return;
    }

    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

// Preload thumbnails before we insert items so the entrance animation doesn't flash a blank tile
// while the network fetch completes.
export function preloadThumbnails(videos: Prettify<VideoSnapshot>[]) {
  return Promise.all(videos.map(video => preloadThumbnail(rawThumbnailUrl(video.rawRenderer))));
}

function buildRichItemContent(
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>
) {
  if (isLockupViewModel(rawRenderer)) {
    return { lockupViewModel: rawRenderer };
  }

  if (isShortsLockupViewModel(rawRenderer)) {
    return { shortsLockupViewModel: rawRenderer };
  }

  return { videoRenderer: rawRenderer };
}

export function buildRichItem(
  rawRenderer: Prettify<InnerTubeVideoRenderer> | Prettify<LockupViewModel> | Prettify<ShortsLockupViewModel>
) {
  return {
    richItemRenderer: {
      content: buildRichItemContent(rawRenderer),
      trackingParams: ""
    }
  };
}
