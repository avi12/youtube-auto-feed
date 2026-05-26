import { ytsuaChannel } from "../messaging";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    const originalFetch = fetch.bind(globalThis);

    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/youtubei/v1/browse")) {
        const body = typeof init?.body === "string" ? init.body : "";
        // The X-YTSUA header is the marker for fetches we issue ourselves, so we don't re-broadcast our own responses.
        const isOurRequest = typeof init?.headers === "object"
          && init.headers !== null
          && "X-YTSUA" in init.headers;
        const isSubscriptionsBrowse = body.includes("FEsubscriptions") && !isOurRequest;
        if (isSubscriptionsBrowse) {
          const response = await originalFetch(input, init);
          response.clone().json()
            .then(data => dispatchEvent(new CustomEvent("ytsua-browse-response", { detail: data })))
            .catch(() => {});
          return response;
        }
      }

      if (url.includes("/youtubei/v1/subscription/")) {
        const response = await originalFetch(input, init);        if (response.ok) {
          dispatchEvent(new CustomEvent("ytsua-subscription-change"));
          ytsuaChannel.sendMessage("subscription-change");
        }

        return response;
      }

      return originalFetch(input, init);
    };
  }
});
