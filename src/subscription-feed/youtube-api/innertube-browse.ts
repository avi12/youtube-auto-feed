// The subscriptions feed used to be readable by re-fetching the feed page and scraping the
// ytInitialData out of its HTML. YouTube now resolves the signed-in identity for that request from
// headers a page fetch cannot carry, so on a brand account it answers with the default account's
// feed - which has no subscriptions - and the scrape yields nothing at all. Asking InnerTube
// directly is what the page itself does.

import { InnerTubeEndpoint, postInnerTube } from "./innertube-request";

const SUBSCRIPTIONS_BROWSE_ID = "FEsubscriptions";

export async function fetchSubscriptionsBrowse() {
  return postInnerTube({
    endpoint: InnerTubeEndpoint.Browse,
    payload: { browseId: SUBSCRIPTIONS_BROWSE_ID }
  });
}
