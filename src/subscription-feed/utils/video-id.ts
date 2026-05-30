import { isLockupViewModel, isShortsLockupViewModel, isVideoRenderer } from "../youtube-api/guards";
import { isRecord } from "./records";

// Pulls a videoId out of whatever renderer shape a Polymer element's `data` happens to be:
// videoRenderer, gridVideoRenderer, richGridMediaRenderer, lockupViewModel, or shortsLockupViewModel.
// Returns null if no recognised renderer is present (e.g. continuation items, section headers).
export function videoIdFromData(data: unknown) {
  if (!isRecord(data)) {
    return null;
  }

  if (isVideoRenderer(data)) {
    return data.videoId || null;
  }

  const content = data.content;
  if (!isRecord(content)) {
    return null;
  }

  const { videoRenderer, gridVideoRenderer, richGridMediaRenderer, lockupViewModel, shortsLockupViewModel } = content;
  if (isVideoRenderer(videoRenderer)) {
    return videoRenderer.videoId || null;
  }

  if (isVideoRenderer(gridVideoRenderer)) {
    return gridVideoRenderer.videoId || null;
  }

  const richGridInner = isRecord(richGridMediaRenderer) ? richGridMediaRenderer.content : null;
  if (isRecord(richGridInner) && isVideoRenderer(richGridInner.videoRenderer)) {
    return richGridInner.videoRenderer.videoId || null;
  }

  // Some lockup payloads use `videoId` instead of `contentId`; fall through to a Record check for those.
  if (isLockupViewModel(lockupViewModel) && lockupViewModel.contentId) {
    return lockupViewModel.contentId;
  }

  if (isRecord(lockupViewModel)) {
    return stringOrNull(lockupViewModel.videoId);
  }

  if (isShortsLockupViewModel(shortsLockupViewModel)) {
    return shortsLockupViewModel.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || null;
  }

  return null;
}

// Used for the legacy inner-shelf list shape (horizontalListRenderer / gridRenderer items), where
// the renderer is at the list-item root rather than nested under `content`.
export function videoIdFromShelfListItem(listItem: unknown) {
  if (!isRecord(listItem)) {
    return "";
  }

  const { videoRenderer, gridVideoRenderer } = listItem;
  if (isVideoRenderer(videoRenderer)) {
    return videoRenderer.videoId;
  }

  if (isVideoRenderer(gridVideoRenderer)) {
    return gridVideoRenderer.videoId;
  }

  return "";
}

function stringOrNull(value: unknown) {
  const isNonEmptyString = typeof value === "string" && value.length > 0;
  return isNonEmptyString ? value : null;
}
