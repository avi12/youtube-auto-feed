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

export function deepString(object: unknown, ...path: string[]) {
  const value = dig(object, ...path);
  return typeof value === "string" ? value : "";
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
  const videoId =
    deepString(data, "videoId") ||
    deepString(data, "content", "videoRenderer", "videoId") ||
    deepString(data, "content", "gridVideoRenderer", "videoId") ||
    deepString(data, "content", "richGridMediaRenderer", "content", "videoRenderer", "videoId") ||
    deepString(data, "content", "lockupViewModel", "contentId") ||
    deepString(data, "content", "lockupViewModel", "videoId") ||
    deepString(data, "content", "shortsLockupViewModel", "onTap", "innertubeCommand", "reelWatchEndpoint", "videoId");
  return videoId !== "" ? videoId : null;
}

export function videoIdFromShelfListItem(listItem: unknown) {
  return deepString(listItem, "videoRenderer", "videoId") || deepString(listItem, "gridVideoRenderer", "videoId");
}

export function isOnSubscriptionsPage() {
  return location.pathname === SUBSCRIPTIONS_PATH;
}
