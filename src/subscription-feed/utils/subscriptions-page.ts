const SUBSCRIPTIONS_PATH = "/feed/subscriptions";

export function isOnSubscriptionsPage() {
  return location.pathname === SUBSCRIPTIONS_PATH;
}
