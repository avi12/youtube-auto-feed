import { WATCH_VIDEO_ID_PARAM } from "./video-id";

const SUBSCRIPTIONS_PATH = "/feed/subscriptions";
const WATCH_PATH = "/watch";
const SHORTS_PATH_PREFIX = "/shorts/";

export function isOnSubscriptionsPage() {
  return location.pathname === SUBSCRIPTIONS_PATH;
}

export function isOnShortsPage() {
  return location.pathname.startsWith(SHORTS_PATH_PREFIX);
}

export function isOnVideoPage() {
  return location.pathname === WATCH_PATH || isOnShortsPage();
}

export function videoIdFromLocation() {
  if (isOnShortsPage()) {
    return location.pathname.slice(SHORTS_PATH_PREFIX.length).split("/")[0] || null;
  }

  // A playlist page plays its current video under the same parameter, so the list id is ignored here.
  return location.pathname === WATCH_PATH ? new URLSearchParams(location.search).get(WATCH_VIDEO_ID_PARAM) : null;
}
