import type { InnerTubeBrowseResponse, Prettify } from "../types";
import { isInnerTubeBrowseResponse } from "./guards";
import { extractApiSectionOrder, parseApiResponse } from "./parse";

function extractYtInitialData(html: string) {
  const match = /var ytInitialData = (.+?);<\/script>/s.exec(html);
  if (!match) {
    return null;
  }

  try {
    const parsed: Prettify<InnerTubeBrowseResponse> = JSON.parse(match[1]);
    return parsed;
  } catch {
    return null;
  }
}

// Re-fetch the page HTML rather than reading window.ytInitialData: that global stays
// frozen across YouTube SPA navigation and would feed us stale snapshots.
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
  return {
    snapshots,
    sectionOrder
  };
}
