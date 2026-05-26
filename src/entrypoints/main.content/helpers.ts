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

export function deepRecord(object: unknown, ...path: string[]) {
  const value = dig(object, ...path);
  return isRecord(value) ? value : null;
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

  if (isVideoRenderer(content.videoRenderer)) {
    return content.videoRenderer.videoId || null;
  }

  if (isVideoRenderer(content.gridVideoRenderer)) {
    return content.gridVideoRenderer.videoId || null;
  }

  const richGridMedia = content.richGridMediaRenderer;
  const richGridInner = isRecord(richGridMedia) ? richGridMedia.content : null;
  if (isRecord(richGridInner) && isVideoRenderer(richGridInner.videoRenderer)) {
    return richGridInner.videoRenderer.videoId || null;
  }

  const lockup = content.lockupViewModel;
  if (isLockupViewModel(lockup)) {
    return lockup.contentId || stringOrNull(lockup.videoId);
  }

  if (isRecord(lockup)) {
    return stringOrNull(lockup.videoId);
  }

  const shorts = content.shortsLockupViewModel;
  if (isShortsLockupViewModel(shorts)) {
    return shorts.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || null;
  }

  return null;
}

export function videoIdFromShelfListItem(listItem: unknown) {
  if (!isRecord(listItem)) {
    return "";
  }

  if (isVideoRenderer(listItem.videoRenderer)) {
    return listItem.videoRenderer.videoId;
  }

  if (isVideoRenderer(listItem.gridVideoRenderer)) {
    return listItem.gridVideoRenderer.videoId;
  }

  return "";
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

export function isOnSubscriptionsPage() {
  return location.pathname === SUBSCRIPTIONS_PATH;
}
