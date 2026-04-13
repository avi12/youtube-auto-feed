import { isInnerTubeBrowseResponse, parseApiResponse } from "./parse";

export async function fetchInitialVideos() {
  const response = await fetch("https://www.youtube.com/feed/subscriptions", {
    credentials: "include"
  }).catch(() => null);
  if (!response) {
    return null;
  }

  const html = await response.text().catch(() => null);
  if (!html) {
    return null;
  }

  const match = html.match(/var ytInitialData = (\{.+?\});<\/script>/s);
  if (!match) {
    return null;
  }

  let browseData: unknown;
  try {
    browseData = JSON.parse(match[1]);
  } catch {
    return null;
  }

  if (!isInnerTubeBrowseResponse(browseData)) {
    return null;
  }

  const snapshots = parseApiResponse(browseData);
  return snapshots.length > 0 ? snapshots : null;
}
