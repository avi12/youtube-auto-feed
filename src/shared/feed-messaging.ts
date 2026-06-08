import { defineCustomEventMessaging } from "@webext-core/messaging/page";

// Typed CustomEvent channel (same mechanism as the settings bridge) between the MAIN-world fetch
// interceptor and the MAIN-world monitor. Browse payload crosses as `unknown`; monitor validates.
interface FeedProtocolMap {
  browseResponse(response: unknown): void;
  subscriptionChange(): void;
}

export const feedMessenger = defineCustomEventMessaging<FeedProtocolMap>({ namespace: "ytaf-feed" });
