import type { Prettify } from "../../types/prettify";

// Locating the thumbnail <img> across shadow-DOM lockups and legacy markup, plus the watch-progress
// bar, which lives in the same shadow tree.

const PROGRESS_BAR_HOST_TAG = "yt-thumbnail-overlay-progress-bar-view-model";
const THUMBNAIL_VIEW_MODEL_TAG = "yt-thumbnail-view-model";
const BOTTOM_OVERLAY_TAG = "yt-thumbnail-bottom-overlay-view-model";
const THUMBNAIL_LARGE_CLASS = "ytThumbnailViewModelLarge";
const BOTTOM_OVERLAY_HOST_CLASS = "ytThumbnailBottomOverlayViewModelHost";
const PROGRESS_BAR_HOST_CLASS = "ytThumbnailOverlayProgressBarHost";
const PROGRESS_BAR_HOST_LARGE_CLASS = "ytThumbnailOverlayProgressBarHostLarge";
const PROGRESS_BAR_TRACK_CLASS = "ytThumbnailOverlayProgressBarHostWatchedProgressBar ytThumbnailOverlayProgressBarHostUseLegacyBar";
const PROGRESS_BAR_SEGMENT_CLASS = "ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment";

type FindImgInYtImagesParams = Prettify<{
  root: ShadowRoot | HTMLElement;
  selector: string;
}>;

function findImgInYtImages({ root, selector }: FindImgInYtImagesParams) {
  for (const elYtImage of root.querySelectorAll<HTMLElement>(selector)) {
    const elImg = elYtImage.shadowRoot?.querySelector<HTMLImageElement>("img")
      ?? elYtImage.querySelector<HTMLImageElement>("img");
    if (elImg) {
      return elImg;
    }
  }
  return null;
}

export function findThumbnailImg(elLockup: HTMLElement) {
  const root: ShadowRoot | HTMLElement = elLockup.shadowRoot ?? elLockup;
  // Prefer yt-thumbnail-view-model's <img> over a bare yt-image (channel avatar or lazy slot
  // left mid-rebind) - writing src to a non-visible yt-image leaves the tile showing the wrong image.
  const elThumbnailViewModelImg = root.querySelector<HTMLImageElement>("yt-thumbnail-view-model img");
  if (elThumbnailViewModelImg) {
    return elThumbnailViewModelImg;
  }

  return findImgInYtImages({
    root,
    selector: "yt-image"
  });
}

type ApplyProgressBarUpdateParams = Prettify<{
  elLockup: HTMLElement;
  percent: number | null;
}>;

// The first time a video gains watch progress YouTube has not stamped the overlay element yet. Build
// it in place rather than rebuilding the whole renderer, which re-stamps the <img> and flickers the
// thumbnail. The class-based stylesheet supplies the red gradient once the element carries the names.
function buildProgressBarHost(isLarge: boolean) {
  const elHost = document.createElement(PROGRESS_BAR_HOST_TAG);
  elHost.className = isLarge ? `${PROGRESS_BAR_HOST_CLASS} ${PROGRESS_BAR_HOST_LARGE_CLASS}` : PROGRESS_BAR_HOST_CLASS;
  const elTrack = document.createElement("div");
  elTrack.className = PROGRESS_BAR_TRACK_CLASS;
  const elSegment = document.createElement("div");
  elSegment.className = PROGRESS_BAR_SEGMENT_CLASS;
  elTrack.append(elSegment);
  elHost.append(elTrack);
  return elHost;
}

function ensureBottomOverlay(elThumbnail: HTMLElement) {
  const elExisting = elThumbnail.querySelector<HTMLElement>(`:scope > ${BOTTOM_OVERLAY_TAG}`);
  if (elExisting) {
    return elExisting;
  }

  const elBottomOverlay = document.createElement(BOTTOM_OVERLAY_TAG);
  elBottomOverlay.className = BOTTOM_OVERLAY_HOST_CLASS;
  elThumbnail.append(elBottomOverlay);
  return elBottomOverlay;
}

function ensureProgressBarHost(elLockup: HTMLElement) {
  const root: ShadowRoot | HTMLElement = elLockup.shadowRoot ?? elLockup;
  const elExistingHost = root.querySelector<HTMLElement>(PROGRESS_BAR_HOST_TAG);
  if (elExistingHost) {
    return elExistingHost;
  }

  const elThumbnail = root.querySelector<HTMLElement>(THUMBNAIL_VIEW_MODEL_TAG);
  if (!elThumbnail) {
    return null;
  }

  const elHost = buildProgressBarHost(elThumbnail.classList.contains(THUMBNAIL_LARGE_CLASS));
  ensureBottomOverlay(elThumbnail).prepend(elHost);
  return elHost;
}

export function applyProgressBarUpdate({ elLockup, percent }: ApplyProgressBarUpdateParams) {
  if (percent === null) {
    return false;
  }

  const elProgressHost = ensureProgressBarHost(elLockup);
  if (!elProgressHost) {
    return false;
  }

  const fillRoot: ShadowRoot | HTMLElement = elProgressHost.shadowRoot ?? elProgressHost;
  const elFill = fillRoot.querySelector<HTMLElement>(":scope > div > div");
  if (!elFill) {
    return false;
  }

  elFill.style.width = `${percent}%`;
  return true;
}

export function findThumbnailImgInItem(elItem: HTMLElement) {
  const elLockup = elItem.querySelector<HTMLElement>("yt-lockup-view-model");
  if (elLockup) {
    const elImg = findThumbnailImg(elLockup);
    if (elImg) {
      return elImg;
    }
  }

  // A shorts lockup nests its <img> in a bare yt-thumbnail-view-model with no lockup or
  // ytd-thumbnail wrapper.
  const elThumbnailViewModelImg = elItem.querySelector<HTMLImageElement>(`${THUMBNAIL_VIEW_MODEL_TAG} img`);
  if (elThumbnailViewModelImg) {
    return elThumbnailViewModelImg;
  }

  return findImgInYtImages({
    root: elItem,
    selector: "ytd-thumbnail yt-image"
  });
}
