import { defineCustomEventMessaging } from "@webext-core/messaging/page";

interface FeedProtocolMap {
  browseResponse(response: unknown): void;
  subscriptionChange(): void;
}

export const feedMessenger = defineCustomEventMessaging<FeedProtocolMap>({ namespace: "ytaf-feed" });
