import { collectAllVideoSnapshots } from "./collect-all-videos";
import { isInnerTubeBrowseResponse } from "./guards";
import { fetchSubscriptionsBrowse } from "./innertube-browse";
import { extractApiContents, extractApiSectionOrder, parseApiResponse } from "./parse-response";

function parseInitialData(html: string): unknown {
  const scriptMatch = /var ytInitialData = (.+?);<\/script>/s.exec(html);
  if (!scriptMatch) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(scriptMatch[1]);
    return parsed;
  } catch {
    return null;
  }
}

// global ytInitialData freezes at page load and goes stale across SPA nav; re-fetch the page HTML.
async function fetchInitialData(path: string) {
  const response = await fetch(path, { credentials: "include" }).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  const html = await response.text().catch(() => null);
  return html ? parseInitialData(html) : null;
}

function toBrowseResult(browseData: unknown) {
  if (!isInnerTubeBrowseResponse(browseData)) {
    return null;
  }

  const snapshots = parseApiResponse(browseData);
  if (snapshots.length === 0) {
    return null;
  }

  return {
    snapshots,
    sectionOrder: extractApiSectionOrder(browseData),
    apiContents: extractApiContents(browseData)
  };
}

// InnerTube is asked first: it is the only route that carries the signed-in identity, and on a brand
// account re-fetching the feed page answers for the default account instead - a feed with no
// subscriptions, which parses to nothing. The page scrape stays as a fallback for the case where the
// signing material is unavailable.
export async function fetchInitialVideos() {
  const browseResult = toBrowseResult(await fetchSubscriptionsBrowse());
  if (browseResult) {
    return browseResult;
  }

  return toBrowseResult(await fetchInitialData("/feed/subscriptions"));
}

// Page-agnostic metadata source: re-fetch whatever page is open and deep-collect every video in it.
export async function fetchPageVideos() {
  const data = await fetchInitialData(location.pathname + location.search);
  if (!data) {
    return null;
  }

  const snapshots = collectAllVideoSnapshots(data);
  return snapshots.length > 0 ? snapshots : null;
}
