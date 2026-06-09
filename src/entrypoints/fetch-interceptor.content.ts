import { feedMessenger } from "../shared/feed-messaging";
import { ytafChannel } from "../shared/messaging";
import { z } from "../shared/zod";

declare global {
  // Exposed so the CDP test harness can inject browse responses through the interceptor's messenger.
  var __ytafFeedMessenger: typeof feedMessenger | undefined;
}

const BROWSE_ENDPOINT = "/youtubei/v1/browse";
const SUBSCRIPTION_ENDPOINT = "/youtubei/v1/subscription/";
const SUBSCRIPTIONS_BROWSE_ID = "FEsubscriptions";
const OWN_REQUEST_MARKER_HEADER = "X-YTAF";

const requestBodySchema = z.string().catch("");
const ownRequestSchema = z.looseObject({ [OWN_REQUEST_MARKER_HEADER]: z.string() });

function isOwnRequest(headers: HeadersInit | undefined) {
  return ownRequestSchema.safeParse(headers).success;
}

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    globalThis.__ytafFeedMessenger = feedMessenger;
    const originalFetch = fetch.bind(globalThis);

    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes(BROWSE_ENDPOINT)) {
        const { body, headers } = init ?? {};
        const requestBody = requestBodySchema.parse(body);
        const isSubscriptionsFeed = requestBody.includes(SUBSCRIPTIONS_BROWSE_ID) && !isOwnRequest(headers);
        if (isSubscriptionsFeed) {
          const response = await originalFetch(input, init);
          response.clone().json()
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
