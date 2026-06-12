// Authenticated InnerTube POST, built from the page's ytcfg plus a SAPISIDHASH header the way the
// watch page calls the API. An unauthenticated /player reports valid videos as unavailable, so the
// auth header matters. Returns the parsed JSON, or null on any missing config / network failure.

const YOUTUBE_ORIGIN = "https://www.youtube.com";
const WEB_CLIENT_NAME = "1";

async function sapisidHashHeader() {
  const sapisid = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)?.[1];
  if (!sapisid) {
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const digest = await crypto.subtle.digest(
    "SHA-1", new TextEncoder().encode(`${timestamp} ${sapisid} ${YOUTUBE_ORIGIN}`)
  );
  const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `SAPISIDHASH ${timestamp}_${hex}`;
}

export async function innertubePost(endpoint: string, payload: Record<string, unknown>) {
  const apiKey = ytcfg?.get("INNERTUBE_API_KEY");
  const context = ytcfg?.get("INNERTUBE_CONTEXT");
  if (!apiKey || !context) {
    return null;
  }

  const Authorization = await sapisidHashHeader();
  const response = await fetch(`/youtubei/v1/${endpoint}?key=${apiKey}&prettyPrint=false`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Youtube-Client-Name": WEB_CLIENT_NAME,
      "X-Youtube-Client-Version": context.client.clientVersion,
      ...Authorization && {
        Authorization,
        "X-Origin": YOUTUBE_ORIGIN
      }
    },
    body: JSON.stringify({
      context,
      ...payload
    })
  }).catch(() => null);
  return response?.ok ? response.json().catch(() => null) : null;
}
