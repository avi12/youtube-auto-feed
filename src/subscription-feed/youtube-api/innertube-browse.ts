// The subscriptions feed used to be readable by re-fetching the feed page and scraping the
// ytInitialData out of its HTML. YouTube now resolves the signed-in identity for that request from
// headers a page fetch cannot carry, so on a brand account it answers with the default account's
// feed - which has no subscriptions - and the scrape yields nothing at all.
//
// Asking InnerTube directly is what the page itself does. Two headers decide whether the answer is
// the real feed or an empty one: the SAPISIDHASH authorization the whole YouTube app signs its calls
// with, and the page id naming the brand account. Drop either and the response silently degrades to a
// channel-discovery page with zero videos.

const YOUTUBE_ORIGIN = "https://www.youtube.com";
const BROWSE_ENDPOINT = "/youtubei/v1/browse?prettyPrint=false";
const SUBSCRIPTIONS_BROWSE_ID = "FEsubscriptions";
const APISID_COOKIE_NAMES = ["SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID"] as const;

function readCookie(name: string) {
  for (const entry of document.cookie.split(";")) {
    const separator = entry.indexOf("=");
    if (separator !== -1 && entry.slice(0, separator).trim() === name) {
      return entry.slice(separator + 1);
    }
  }
  return null;
}

function readApisidCookie() {
  for (const name of APISID_COOKIE_NAMES) {
    const value = readCookie(name);
    if (value) {
      return value;
    }
  }
  return null;
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// YouTube signs API calls with SHA-1 over "<seconds> <APISID> <origin>", sent under both the first-
// and third-party scheme names because the cookie may be present under either.
async function buildAuthorization() {
  const apisid = readApisidCookie();
  if (!apisid) {
    return null;
  }

  const seconds = Math.floor(Date.now() / 1000);
  const digest = await crypto.subtle
    .digest("SHA-1", new TextEncoder().encode(`${seconds} ${apisid} ${YOUTUBE_ORIGIN}`))
    .catch(() => null);
  if (!digest) {
    return null;
  }

  const signature = `${seconds}_${toHex(digest)}`;
  return `SAPISIDHASH ${signature} SAPISID3PHASH ${signature}`;
}

async function buildBrowseHeaders() {
  const authorization = await buildAuthorization();
  const context = ytcfg?.get("INNERTUBE_CONTEXT");
  if (!authorization || !context) {
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: authorization,
    "X-Origin": YOUTUBE_ORIGIN,
    "X-Goog-AuthUser": ytcfg?.get("SESSION_INDEX") ?? "0",
    "X-Youtube-Client-Name": "1",
    "X-Youtube-Client-Version": context.client.clientVersion
  };

  const pageId = ytcfg?.get("DELEGATED_SESSION_ID");
  if (pageId) {
    headers["X-Goog-PageId"] = pageId;
  }

  return headers;
}

export async function fetchSubscriptionsBrowse() {
  const headers = await buildBrowseHeaders();
  const context = ytcfg?.get("INNERTUBE_CONTEXT");
  if (!headers || !context) {
    return null;
  }

  const response = await fetch(BROWSE_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({
      context,
      browseId: SUBSCRIPTIONS_BROWSE_ID
    })
  }).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  const parsed: unknown = await response.json().catch(() => null);
  return parsed;
}
