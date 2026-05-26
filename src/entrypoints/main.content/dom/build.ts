import { isLockupViewModel, isShortsLockupViewModel } from "../api/guards";
import type {
  InnerTubeVideoRenderer,
  LockupViewModel,
  Prettify,
  ShortsLockupViewModel,
  VideoSnapshot
} from "../types";

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

function preloadThumbnail(url: string) {
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
