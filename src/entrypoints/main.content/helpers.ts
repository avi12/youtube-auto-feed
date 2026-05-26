import { isLockupViewModel, isShortsLockupViewModel, isVideoRenderer } from "./api/guards";
import { type PolymerElement } from "./types";

const SUBSCRIPTIONS_PATH = "/feed/subscriptions";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPolymerElement(element: Element): element is PolymerElement {
  return "data" in element;
}

function isIndexable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function dig(object: unknown, ...path: string[]) {
  let current = object;
  for (const key of path) {
    if (!isIndexable(current)) {
      return undefined;
    }

    current = current[key];
  }
  return current;
}

export function deepArray<T = unknown>(object: unknown, ...path: string[]): T[] {
  const value = dig(object, ...path);
  if (Array.isArray(value)) {
    return value;
  }

  return [];
}

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

  // Some lockup payloads use `videoId` instead of `contentId`; fall through to a Record check for those
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

export function isOnSubscriptionsPage() {
  return location.pathname === SUBSCRIPTIONS_PATH;
}
