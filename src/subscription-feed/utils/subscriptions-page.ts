const SUBSCRIPTIONS_PATH = "/feed/subscriptions";
const WATCH_PATH = "/watch";
const SHORTS_PATH_PREFIX = "/shorts/";

export function isOnSubscriptionsPage() {
  return location.pathname === SUBSCRIPTIONS_PATH;
}

export function isOnVideoPage() {
  return location.pathname === WATCH_PATH || location.pathname.startsWith(SHORTS_PATH_PREFIX);
}
