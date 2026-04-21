import { isInnerTubeBrowseResponse } from "./guards";
import { parseApiResponse } from "./parse";

async function buildSapiSidHash() {
  const sapiSid = document.cookie.split(";")
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith("__Secure-3PAPISID="))
    ?.split("=")[1];
  if (!sapiSid) {
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${timestamp} ${sapiSid} https://www.youtube.com`;
  const hashBuffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(message));
  const hash = Array.from(new Uint8Array(hashBuffer)).map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `SAPISIDHASH ${timestamp}_${hash}`;
}

export async function fetchInitialVideos() {
  const context = ytcfg?.get("INNERTUBE_CONTEXT") ?? null;
  if (!context) {
    return null;
  }

  const apiKey = ytcfg?.get("INNERTUBE_API_KEY") ?? "";
  const authorization = await buildSapiSidHash();
  const url = apiKey
    ? `/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`
    : "/youtubei/v1/browse?prettyPrint=false";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-YTSUA": "1",
      ...(authorization ? { "Authorization": authorization } : {})
    },
    credentials: "include",
    body: JSON.stringify({ context, browseId: "FEsubscriptions" })
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  let browseData: unknown;
  try {
    browseData = await response.json();
  } catch {
    return null;
  }

  if (!isInnerTubeBrowseResponse(browseData)) {
    return null;
  }

  const snapshots = parseApiResponse(browseData);
  return snapshots.length > 0 ? snapshots : null;
}
