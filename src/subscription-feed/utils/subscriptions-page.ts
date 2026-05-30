const SUBSCRIPTIONS_PATH = "/feed/subscriptions";

// The extension only mutates the feed on this exact URL. SPA navigation can change the pathname
// without a full reload, so every poll/event handler re-checks this before doing anything.
export function isOnSubscriptionsPage() {
  return location.pathname === SUBSCRIPTIONS_PATH;
}
