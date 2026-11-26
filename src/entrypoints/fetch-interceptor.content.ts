import { isRequest } from "@/shared/dom-guards";
import { feedMessenger } from "@/shared/feed-messaging";
import { ytafChannel } from "@/shared/messaging";
import { OWN_REQUEST_MARKER_HEADER } from "@/shared/own-request";
import { z } from "@/shared/zod";
import { createGuard } from "@/shared/zod-guard";

declare global {
  // Exposed so the CDP test harness can inject browse responses through the interceptor's messenger.
  var __ytafFeedMessenger: typeof feedMessenger | undefined;
  // The YouTube Semi-Subscribe contract version: 1 keeps the videos it tags, so it may list Shorts; 2 also
  // removes the videos it names as hidden.
  var __ytafHonorsSemiSubTags: number | undefined;
}

const BROWSE_ENDPOINT = "/youtubei/v1/browse";
const SEMI_SUB_CONTRACT_VERSION = 2;
const SUBSCRIPTION_ENDPOINT = "/youtubei/v1/subscription/";
const SUBSCRIPTIONS_BROWSE_ID = "FEsubscriptions";

const requestBodySchema = z.string().catch("");
const isOwnRequest = createGuard(z.looseObject({ [OWN_REQUEST_MARKER_HEADER]: z.string() }));

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    globalThis.__ytafFeedMessenger = feedMessenger;
    globalThis.__ytafHonorsSemiSubTags = SEMI_SUB_CONTRACT_VERSION;
    const originalFetch = fetch.bind(globalThis);

    globalThis.fetch = async (input, init) => {
      const url = isRequest(input) ? input.url : String(input);
      if (url.includes(BROWSE_ENDPOINT)) {
        const { body, headers } = init ?? {};
        const requestBody = requestBodySchema.parse(body);
        const isSubscriptionsFeed = requestBody.includes(SUBSCRIPTIONS_BROWSE_ID) && !isOwnRequest(headers);
        if (isSubscriptionsFeed) {
          const response = await originalFetch(input, init);
          response
            .clone()
            .json()
            .then(data => feedMessenger.sendMessage("browseResponse", data))
            .catch(() => {});
          return response;
        }
      }

      if (url.includes(SUBSCRIPTION_ENDPOINT)) {
        const response = await originalFetch(input, init);
        if (response.ok) {
          feedMessenger.sendMessage("subscriptionChange").catch(() => {});
          ytafChannel.sendMessage("subscription-change");
        }

        return response;
      }

      return originalFetch(input, init);
    };
  }
});
