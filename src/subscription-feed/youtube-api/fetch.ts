import { isInnerTubeBrowseResponse } from "./guards";
import { extractApiContents, extractApiSectionOrder, parseApiResponse } from "./parse-response";

function extractYtInitialData(html: string) {
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
export async function fetchInitialVideos() {
  const response = await fetch("/feed/subscriptions", {
    credentials: "include"
  }).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  const html = await response.text().catch(() => null);
  if (!html) {
    return null;
  }

  const browseData = extractYtInitialData(html);
  if (!isInnerTubeBrowseResponse(browseData)) {
    return null;
  }

  const snapshots = parseApiResponse(browseData);
  if (snapshots.length === 0) {
    return null;
  }

  const sectionOrder = extractApiSectionOrder(browseData);
  const apiContents = extractApiContents(browseData);
  return {
    snapshots,
    sectionOrder,
    apiContents
  };
}
