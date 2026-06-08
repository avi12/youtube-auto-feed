const SUBSCRIPTIONS_PATH = "/feed/subscriptions";

// SPA navigation changes pathname without a reload - every poll/handler re-checks this guard.
export function isOnSubscriptionsPage() {
  return location.pathname === SUBSCRIPTIONS_PATH;
}
