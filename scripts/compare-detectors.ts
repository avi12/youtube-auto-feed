/**
 * Snapshot subscriptions feed in Edge (9232) + Chrome (9233) via raw CDP.
 * Diffs section order + per-section video IDs and saves screenshots.
 * Chrome = ground truth (no extension); Edge = extension under test.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

interface CdpTarget {
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface BandSnapshot {
  header: string | null;
  kind: "inline" | "richShelf" | "shelf";
  videoIds: string[];
}

interface PageSnapshot {
  url: string;
  bands: BandSnapshot[];
  contentsLength: number;
  hasExtension: boolean;
}

async function getYouTubeTarget(port: number) {
  const response = await fetch(`http://localhost:${port}/json`);
  const targets: CdpTarget[] = await response.json();
  return targets.find(target =>
    target.type === "page"
    && target.url.includes("youtube.com/feed/subscriptions")
    && target.webSocketDebuggerUrl);
}

function sendCommand<T>(webSocketUrl: string, method: string, params: Record<string, unknown> = {}) {
  return new Promise<T>((resolvePromise, reject) => {
    const socket = new WebSocket(webSocketUrl);
    socket.onopen = () => socket.send(
      JSON.stringify({
        id: 1,
        method,
        params
      })
    );
    socket.onmessage = e => {
      const data = JSON.parse(String(e.data));
      if (data.id !== 1) {
        return;
      }

      socket.close();

      if (data.error) {
        return reject(new Error(JSON.stringify(data.error)));
      }

      resolvePromise(data.result);
    };
    socket.onerror = () => reject(new Error("ws error"));
  });
}

async function evaluate<T>(webSocketUrl: string, expression: string) {
  const result = await sendCommand<{
    result: { value: T };
  }>(webSocketUrl, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return result.result.value;
}

const SNAPSHOT_EXPRESSION = `(() => {
  const elGrid = document.querySelector("ytd-rich-grid-renderer");
  if (!elGrid) return { url: location.href, bands: [], contentsLength: 0, hasExtension: !!globalThis.__ytsuaDebug };
  const contents = elGrid.data?.contents ?? [];

  const deepString = (data, ...path) => {
    let cur = data;
    for (const key of path) { if (cur && typeof cur === "object") cur = cur[key]; else return ""; }
    return typeof cur === "string" ? cur : "";
  };
  const videoIdFromData = data => deepString(data, "videoId")
    || deepString(data, "content", "videoRenderer", "videoId")
    || deepString(data, "content", "gridVideoRenderer", "videoId")
    || deepString(data, "content", "richGridMediaRenderer", "content", "videoRenderer", "videoId")
    || deepString(data, "content", "lockupViewModel", "contentId")
    || deepString(data, "content", "lockupViewModel", "videoId")
    || deepString(data, "content", "shortsLockupViewModel", "onTap", "innertubeCommand", "reelWatchEndpoint", "videoId")
    || null;
  const richItemVideoId = item => videoIdFromData(item?.richItemRenderer);
  const shelfListItemId = item => deepString(item, "videoRenderer", "videoId") || deepString(item, "gridVideoRenderer", "videoId") || null;

  const bands = [];
  let currentInline = null;

  for (const item of contents) {
    const inlineId = richItemVideoId(item);
    if (inlineId) {
      if (!currentInline) {
        currentInline = { header: null, kind: "inline", videoIds: [] };
        bands.push(currentInline);
      }
      currentInline.videoIds.push(inlineId);
      continue;
    }
    currentInline = null;

    const richShelf = item?.richSectionRenderer?.content?.richShelfRenderer;
    if (richShelf) {
      const header = richShelf.title?.runs?.[0]?.text ?? null;
      const inner = richShelf.contents ?? [];
      bands.push({ header, kind: "richShelf", videoIds: inner.map(richItemVideoId).filter(Boolean) });
      continue;
    }
    const shelf = item?.richSectionRenderer?.content?.shelfRenderer;
    if (shelf) {
      const header = shelf.title?.runs?.[0]?.text ?? shelf.title?.simpleText ?? null;
      const listItems = [
        ...(shelf.content?.horizontalListRenderer?.items ?? []),
        ...(shelf.content?.gridRenderer?.items ?? [])
      ];
      bands.push({ header, kind: "shelf", videoIds: listItems.map(shelfListItemId).filter(Boolean) });
    }
  }

  return { url: location.href, bands, contentsLength: contents.length, hasExtension: !!globalThis.__ytsuaDebug };
})()`;

async function snapshot(port: number, label: string) {
  const target = await getYouTubeTarget(port);
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`${label}: no YouTube tab on port ${port}`);
  }

  const snap = await evaluate<PageSnapshot>(target.webSocketDebuggerUrl, SNAPSHOT_EXPRESSION);
  const shot = await sendCommand<{ data: string }>(target.webSocketDebuggerUrl, "Page.captureScreenshot", { format: "png" });
  return {
    snap,
    screenshot: shot.data
  };
}

function foldByHeader(snap: PageSnapshot) {
  const map = new Map<string, string[]>();
  for (const band of snap.bands) {
    const key = band.header ?? "<inline>";
    const ids = map.get(key) ?? [];
    ids.push(...band.videoIds);
    map.set(key, ids);
  }
  return map;
}

function report(edge: PageSnapshot, chrome: PageSnapshot) {
  console.log(`Edge   (ext=${edge.hasExtension}) contents=${edge.contentsLength} url=${edge.url}`);
  console.log(`Chrome (ext=${chrome.hasExtension}) contents=${chrome.contentsLength} url=${chrome.url}`);
  console.log("\n=== Section order ===");
  console.log(`Edge:   ${edge.bands.map(band => `${band.header ?? "<inline>"}[${band.kind}](${band.videoIds.length})`).join(" -> ")}`);
  console.log(`Chrome: ${chrome.bands.map(band => `${band.header ?? "<inline>"}[${band.kind}](${band.videoIds.length})`).join(" -> ")}`);

  console.log("\n=== Folded diff (inline bands merged per header) ===");
  const edgeMap = foldByHeader(edge);
  const chromeMap = foldByHeader(chrome);
  let hasBug = false;
  for (const header of new Set([...edgeMap.keys(), ...chromeMap.keys()])) {
    const edgeIds = edgeMap.get(header) ?? [];
    const chromeIds = chromeMap.get(header) ?? [];
    const edgeSet = new Set(edgeIds);
    const chromeSet = new Set(chromeIds);
    const edgeOnly = edgeIds.filter(id => !chromeSet.has(id));
    const chromeOnly = chromeIds.filter(id => !edgeSet.has(id));
    console.log(`  [${header}] edge=${edgeIds.length} chrome=${chromeIds.length} common=${edgeIds.filter(id => chromeSet.has(id)).length} edge-only=${edgeOnly.length} chrome-only=${chromeOnly.length}`);

    if (edgeOnly.length) {
      console.log(`    edge-only (kept after YouTube dropped — OK): ${edgeOnly.join(", ")}`);
    }

    if (chromeOnly.length) {
      console.log(`    chrome-only (YouTube shows, Edge missing — BUG candidate): ${chromeOnly.join(", ")}`);
      hasBug = true;
    }
  }

  console.log(`\nVerdict: ${hasBug ? "POSSIBLE BUG (chrome-only ids present)" : "OK (no chrome-only ids)"}`);
}

const outDir = resolve(import.meta.dirname, "..", "tmp", "compare");
mkdirSync(outDir, { recursive: true });

const edge = await snapshot(9232, "Edge");
const chrome = await snapshot(9233, "Chrome");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const edgePath = resolve(outDir, `edge-${stamp}.png`);
const chromePath = resolve(outDir, `chrome-${stamp}.png`);
writeFileSync(edgePath, Buffer.from(edge.screenshot, "base64"));
writeFileSync(chromePath, Buffer.from(chrome.screenshot, "base64"));

report(edge.snap, chrome.snap);
console.log(`\nScreenshots:\n  Edge:   ${edgePath}\n  Chrome: ${chromePath}`);
