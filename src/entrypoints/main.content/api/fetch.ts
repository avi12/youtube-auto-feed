import { isRecord } from "../helpers";
import type { InnerTubeContext } from "../types";
import { isInnerTubeBrowseResponse } from "./guards";
import { parseApiResponse } from "./parse";

function readInnerTubeContext(): InnerTubeContext | null {
  const ytcfg = (globalThis as Record<string, unknown>).ytcfg;
  if (!isRecord(ytcfg) || typeof ytcfg.get !== "function") return null;
  const context = (ytcfg.get as (key: string) => unknown)("INNERTUBE_CONTEXT");
  return isRecord(context) ? context as InnerTubeContext : null;
}

function readInnerTubeApiKey() {
  const ytcfg = (globalThis as Record<string, unknown>).ytcfg;
  if (!isRecord(ytcfg) || typeof ytcfg.get !== "function") return "";
  const key = (ytcfg.get as (key: string) => unknown)("INNERTUBE_API_KEY");
  return typeof key === "string" ? key : "";
}

async function buildSapiSidHash() {
  const sapiSid = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("__Secure-3PAPISID="))?.split("=")[1];
  if (!sapiSid) return null;
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${timestamp} ${sapiSid} https://www.youtube.com`;
  const hashBuffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(message));
  const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `SAPISIDHASH ${timestamp}_${hash}`;
}

export async function fetchInitialVideos() {
  const context = readInnerTubeContext();
  if (!context) return null;

  const apiKey = readInnerTubeApiKey();
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

  if (!response?.ok) return null;

  let browseData: unknown;
  try {
    browseData = await response.json();
  } catch {
    return null;
  }

  if (!isInnerTubeBrowseResponse(browseData)) return null;

  const snapshots = parseApiResponse(browseData);
  return snapshots.length > 0 ? snapshots : null;
}
