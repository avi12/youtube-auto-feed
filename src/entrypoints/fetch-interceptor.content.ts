import { feedMessenger } from "../shared/feed-messaging";
import { ytafChannel } from "../shared/messaging";
import { z } from "../shared/zod";

// Exposed so the CDP test harness can simulate a browse response through the real messenger. The
// interceptor's messenger is a different instance than the monitor's, so the monitor receives it.
declare global {
  var __ytafFeedMessenger: typeof feedMessenger | undefined;
}

const requestBodySchema = z.string().catch("");
const ourRequestSchema = z.looseObject({ "X-YTAF": z.string() });

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    globalThis.__ytafFeedMessenger = feedMessenger;
    const originalFetch = fetch.bind(globalThis);

    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/youtubei/v1/browse")) {
        const { body: rawBody, headers } = init ?? {};
        const body = requestBodySchema.parse(rawBody);
        // The X-YTAF header is the marker for fetches we issue ourselves, so we don't re-broadcast our own responses.
        const isOurRequest = ourRequestSchema.safeParse(headers).success;
        const isSubscriptionsBrowse = body.includes("FEsubscriptions") && !isOurRequest;
        if (isSubscriptionsBrowse) {
          const response = await originalFetch(input, init);
          response.clone().json()
            .then(data => feedMessenger.sendMessage("browseResponse", data))
            .catch(() => {});
          return response;
        }
      }

      if (url.includes("/youtubei/v1/subscription/")) {
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
