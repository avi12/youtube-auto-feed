import { collectAllVideoSnapshots } from "./collect-all-videos";
import { isInnerTubeBrowseResponse } from "./guards";
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

export async function fetchInitialVideos() {
  const browseData = await fetchInitialData("/feed/subscriptions");
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

// Page-agnostic metadata source: re-fetch whatever page is open and deep-collect every video in it.
export async function fetchPageVideos() {
  const data = await fetchInitialData(location.pathname + location.search);
  if (!data) {
    return null;
  }

  const snapshots = collectAllVideoSnapshots(data);
  return snapshots.length > 0 ? snapshots : null;
}
