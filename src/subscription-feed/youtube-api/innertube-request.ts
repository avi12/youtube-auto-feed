// Every InnerTube call the extension makes is signed the way the YouTube app signs its own. Two
// headers decide whether the answer is the viewer's or a stranger's: the SAPISIDHASH authorization
// derived from the APISID cookie, and the page id naming the brand account. Drop either and the
// response silently degrades to the default account - a feed with no videos, a guide with no
// channels - rather than failing outright. The marker header keeps the fetch interceptor from
// mirroring these calls back to the monitor as if YouTube had made them.

import { OWN_REQUEST_MARKER_HEADER } from "../../shared/own-request";
import type { Prettify } from "../types/prettify";

export enum InnerTubeEndpoint {
  Browse = "/youtubei/v1/browse?prettyPrint=false",
  Guide = "/youtubei/v1/guide?prettyPrint=false"
}

const YOUTUBE_ORIGIN = "https://www.youtube.com";
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

// The signature is SHA-1 over "<seconds> <APISID> <origin>", sent under both the first- and
// third-party scheme names because the cookie may be present under either.
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

async function buildHeaders(clientVersion: string) {
  const authorization = await buildAuthorization();
  if (!authorization) {
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [OWN_REQUEST_MARKER_HEADER]: "1",
    Authorization: authorization,
    "X-Origin": YOUTUBE_ORIGIN,
    "X-Goog-AuthUser": ytcfg?.get("SESSION_INDEX") ?? "0",
    "X-Youtube-Client-Name": "1",
    "X-Youtube-Client-Version": clientVersion
  };

  const pageId = ytcfg?.get("DELEGATED_SESSION_ID");
  if (pageId) {
    headers["X-Goog-PageId"] = pageId;
  }

  return headers;
}

type PostInnerTubeParams = Prettify<{
  endpoint: InnerTubeEndpoint;
  payload?: Record<string, string>;
}>;

export async function postInnerTube({ endpoint, payload }: PostInnerTubeParams) {
  const context = ytcfg?.get("INNERTUBE_CONTEXT");
  if (!context) {
    return null;
  }

  const headers = await buildHeaders(context.client.clientVersion);
  if (!headers) {
    return null;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({
      context,
      ...payload
    })
  }).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  const parsed: unknown = await response.json().catch(() => null);
  return parsed;
}
