import { isLockupViewModel, isShortsLockupViewModel } from "../api/guards";
import type { InnerTubeVideoRenderer, LockupViewModel, ShortsLockupViewModel, VideoSnapshot } from "../types";

function rawThumbnailUrl(rawRenderer: InnerTubeVideoRenderer | LockupViewModel | ShortsLockupViewModel) {
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

export function preloadThumbnails(videos: VideoSnapshot[]) {
  return Promise.all(videos.map(video => preloadThumbnail(rawThumbnailUrl(video.rawRenderer))));
}

function buildRichItemContent(rawRenderer: InnerTubeVideoRenderer | LockupViewModel | ShortsLockupViewModel) {
  if (isLockupViewModel(rawRenderer)) {
    return { lockupViewModel: rawRenderer };
  }

  if (isShortsLockupViewModel(rawRenderer)) {
    return { shortsLockupViewModel: rawRenderer };
  }

  return { videoRenderer: rawRenderer };
}

export function buildRichItem(rawRenderer: InnerTubeVideoRenderer | LockupViewModel | ShortsLockupViewModel) {
  return {
    richItemRenderer: {
      content: buildRichItemContent(rawRenderer),
      trackingParams: ""
    }
  };
}
