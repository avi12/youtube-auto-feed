import { defineCustomEventMessaging } from "@webext-core/messaging/page";

// The MAIN-world fetch interceptor notifies the MAIN-world monitor of fresh InnerTube /browse
// payloads and of subscription changes, over a typed CustomEvent channel (the same mechanism the
// settings bridge uses). The browse payload is YouTube's raw response, so it crosses as `unknown`
// and the monitor validates it before use.
interface FeedProtocolMap {
  browseResponse(response: unknown): void;
  subscriptionChange(): void;
}

export const feedMessenger = defineCustomEventMessaging<FeedProtocolMap>({ namespace: "ytaf-feed" });
