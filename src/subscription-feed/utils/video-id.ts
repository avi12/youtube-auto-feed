import { z } from "../../shared/zod";
import { isLockupViewModel, isShortsLockupViewModel, isVideoRenderer } from "../youtube-api/guards";
import { isRecord } from "./records";

const nonEmptyStringSchema = z.string().min(1);

// Extracts a videoId from a Polymer element's `data` regardless of renderer shape
// (videoRenderer, gridVideoRenderer, richGridMediaRenderer, lockupViewModel, shortsLockupViewModel).
// Returns null for unrecognised shapes (continuation items, section headers).
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

  // Some lockup payloads use `videoId` instead of `contentId`.
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

// For legacy shelf list items (horizontalListRenderer / gridRenderer) where the renderer is at
// the item root, not nested under `content`.
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
  const parsed = nonEmptyStringSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
