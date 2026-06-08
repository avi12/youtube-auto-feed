import { isInnerTubeBrowseResponse } from "./guards";
import { extractApiContents, extractApiSectionOrder, parseApiResponse } from "./parse-response";

function extractYtInitialData(html: string) {
  const match = /var ytInitialData = (.+?);<\/script>/s.exec(html);
  if (!match) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(match[1]);
    return parsed;
  } catch {
    return null;
  }
}

// Re-fetches the subscriptions page HTML so we can extract a fresh ytInitialData payload.
// We deliberately don't read window.ytInitialData: that global is set once at page load and
// stays frozen across YouTube SPA navigation, so it would feed us stale snapshots.
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
