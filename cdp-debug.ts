import WebSocket from "ws";

const BASE_URL = "ws://localhost:9227/devtools/page";
let messageId = 1;

function cdp(pageId: string, method: string, params: Record<string, unknown> = {}) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const ws = new WebSocket(`${BASE_URL}/${pageId}`);
    const currentId = messageId++;
    const timeout = setTimeout(() => { ws.close(); reject(new Error(`timeout: ${method}`)); }, 15_000);
    ws.on("open", () => ws.send(JSON.stringify({ id: currentId, method, params })));
    ws.on("message", (data: Buffer | string) => {
      const msg = JSON.parse(String(data)) as { id: number; result?: Record<string, unknown>; error?: unknown };
      if (msg.id === currentId) {
        clearTimeout(timeout);
        ws.close();
        if (msg.error) { reject(new Error(JSON.stringify(msg.error))); }
        else { resolve(msg.result ?? {}); }
      }
    });
    ws.on("error", (e: Error) => { clearTimeout(timeout); reject(e); });
  });
}

async function evaluate(pageId: string, expression: string) {
  const result = await cdp(pageId, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  const inner = result.result as { value?: unknown; type?: string; description?: string } | undefined;
  return inner?.value ?? inner?.description ?? null;
}

const listResponse = await fetch("http://localhost:9227/json/list");
const targets = await listResponse.json() as Array<{ url: string; id: string; type: string; title: string }>;
const subsTargets = targets.filter(t => t.type === "page" && t.url.includes("/feed/subscriptions"));
console.log("Found", subsTargets.length, "subscriptions tabs");

const SUBS_ID = subsTargets[0].id;
console.log("Using subs page:", SUBS_ID);

await fetch(`http://localhost:9227/json/activate/${SUBS_ID}`).catch(() => {});
await new Promise(resolve => setTimeout(resolve, 1000));

// Get baseline
const state = await evaluate(SUBS_ID, `(() => {
  const grid = document.querySelector("ytd-rich-grid-renderer");
  const gridDataItems = grid && "data" in grid ? (Array.isArray(grid.data?.contents) ? grid.data.contents.length : 0) : 0;
  const richItems = document.querySelectorAll("ytd-rich-item-renderer").length;
  const debug = sessionStorage.getItem("ytsua-debug") ?? "(none)";
  return JSON.stringify({ debug, gridDataItems, richItems });
})()`);
const baseline = JSON.parse(state as string) as { debug: string; gridDataItems: number; richItems: number };
console.log("Baseline:", baseline);

// === TEST 1: Inject a fake new video via ytsua-browse-response ===
// We'll add a fake video at position 0 in the browse response
// by copying an existing video and giving it a different ID

console.log("\n=== TEST 1: Inject fake new video via ytsua-browse-response ===");
const injectResult = await evaluate(SUBS_ID, `(() => {
  const grid = document.querySelector("ytd-rich-grid-renderer");
  if (!grid || !("data" in grid)) return JSON.stringify({ error: "no grid" });
  const contents = Array.isArray(grid.data?.contents) ? grid.data.contents : [];

  // Find the first richItemRenderer with a lockupViewModel or videoRenderer
  let firstVideoItem = null;
  for (const item of contents) {
    if (item?.richItemRenderer?.content?.lockupViewModel || item?.richItemRenderer?.content?.videoRenderer) {
      firstVideoItem = item;
      break;
    }
  }
  if (!firstVideoItem) return JSON.stringify({ error: "no video item found" });

  // Deep clone and modify the video ID to create a "fake" new video
  const fakeItem = JSON.parse(JSON.stringify(firstVideoItem));
  const fakeVideoId = "FAKE_VIDEO_" + Date.now();

  if (fakeItem?.richItemRenderer?.content?.lockupViewModel) {
    fakeItem.richItemRenderer.content.lockupViewModel.contentId = fakeVideoId;
  } else if (fakeItem?.richItemRenderer?.content?.videoRenderer) {
    fakeItem.richItemRenderer.content.videoRenderer.videoId = fakeVideoId;
  }

  return JSON.stringify({ found: true, fakeVideoId, type: Object.keys(firstVideoItem?.richItemRenderer?.content ?? {}).join(",") });
})()`);
console.log("Inject prep:", injectResult);

const injectPrep = JSON.parse(injectResult as string) as { found: boolean; fakeVideoId?: string; type?: string; error?: string };
if (!injectPrep.fakeVideoId) {
  console.log("Cannot inject fake video:", injectPrep.error);
  process.exit(1);
}

const FAKE_VIDEO_ID = injectPrep.fakeVideoId;
console.log("Fake video ID:", FAKE_VIDEO_ID);

// Now inject a browse response that includes the fake video at the top
// We'll use the real browse API to get current data, then prepend the fake video
console.log("\n=== Fetching real browse data to inject modified version ===");
const browseData = await evaluate(SUBS_ID, `(async () => {
  const config = yt?.config_;
  if (!config?.INNERTUBE_CONTEXT) return JSON.stringify({ error: "no config" });
  const cookiePair = document.cookie.split("; ").find(r => r.startsWith("SAPISID="));
  if (!cookiePair) return JSON.stringify({ error: "no SAPISID" });
  const sapisid = cookiePair.slice("SAPISID=".length);
  const ts = Math.floor(Date.now() / 1000);
  const hbuf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(ts + " " + sapisid + " https://www.youtube.com"));
  const auth = "SAPISIDHASH " + ts + "_" + Array.from(new Uint8Array(hbuf)).map(b => b.toString(16).padStart(2,"0")).join("");
  const resp = await fetch("https://www.youtube.com/youtubei/v1/browse", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": auth, "X-YTSUA": "1" },
    body: JSON.stringify({ context: config.INNERTUBE_CONTEXT, browseId: "FEsubscriptions" })
  });
  const data = await resp.json();
  return JSON.stringify({ status: resp.status, hasContents: !!data?.contents });
})()`);
console.log("Browse data:", browseData);

// Inject modified browse response by dispatching event directly
console.log("\n=== Injecting modified browse response with fake new video ===");
const dispatchResult = await evaluate(SUBS_ID, `(async () => {
  const config = yt?.config_;
  if (!config?.INNERTUBE_CONTEXT) return "no config";
  const cookiePair = document.cookie.split("; ").find(r => r.startsWith("SAPISID="));
  if (!cookiePair) return "no SAPISID";
  const sapisid = cookiePair.slice("SAPISID=".length);
  const ts = Math.floor(Date.now() / 1000);
  const hbuf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(ts + " " + sapisid + " https://www.youtube.com"));
  const auth = "SAPISIDHASH " + ts + "_" + Array.from(new Uint8Array(hbuf)).map(b => b.toString(16).padStart(2,"0")).join("");

  // Fetch current feed
  const resp = await fetch("https://www.youtube.com/youtubei/v1/browse", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": auth, "X-YTSUA": "1" },
    body: JSON.stringify({ context: config.INNERTUBE_CONTEXT, browseId: "FEsubscriptions" })
  });
  const data = await resp.json();

  // Find the grid contents
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
  const tabContent = tabs?.[0]?.tabRenderer?.content;
  const gridContents = tabContent?.richGridRenderer?.contents;
  if (!gridContents) return "no grid contents in browse response";

  // Find first video item to clone as fake new video
  let firstVideoItem = null;
  for (const item of gridContents) {
    if (item?.richItemRenderer?.content?.lockupViewModel || item?.richItemRenderer?.content?.videoRenderer) {
      firstVideoItem = item;
      break;
    }
  }
  if (!firstVideoItem) return "no video item to clone";

  // Clone and give fake ID
  const fakeItem = JSON.parse(JSON.stringify(firstVideoItem));
  const fakeVideoId = "${FAKE_VIDEO_ID}";
  if (fakeItem?.richItemRenderer?.content?.lockupViewModel) {
    fakeItem.richItemRenderer.content.lockupViewModel.contentId = fakeVideoId;
  } else if (fakeItem?.richItemRenderer?.content?.videoRenderer) {
    fakeItem.richItemRenderer.content.videoRenderer.videoId = fakeVideoId;
  }

  // Prepend fake video to grid contents
  const modifiedContents = [fakeItem, ...gridContents];
  if (tabContent.richGridRenderer) {
    tabContent.richGridRenderer.contents = modifiedContents;
  }

  // Dispatch as ytsua-browse-response event
  dispatchEvent(new CustomEvent("ytsua-browse-response", { detail: data }));
  return JSON.stringify({ dispatched: true, fakeVideoId, originalCount: gridContents.length, modifiedCount: modifiedContents.length });
})()`);
console.log("Dispatch result:", dispatchResult);

console.log("\n=== Watching for fake video addition ===");
for (let i = 0; i < 10; i++) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  const st = JSON.parse(await evaluate(SUBS_ID, `(() => {
    const g = document.querySelector("ytd-rich-grid-renderer");
    const gLen = g && "data" in g ? (Array.isArray(g.data?.contents) ? g.data.contents.length : 0) : 0;
    const richLen = document.querySelectorAll("ytd-rich-item-renderer").length;
    const debug = sessionStorage.getItem("ytsua-debug") ?? "(none)";
    // Check if fake video is in grid data
    const hasFake = g && "data" in g && Array.isArray(g.data?.contents) ? g.data.contents.some(item => {
      const content = item?.richItemRenderer?.content;
      return content?.lockupViewModel?.contentId === "${FAKE_VIDEO_ID}" || content?.videoRenderer?.videoId === "${FAKE_VIDEO_ID}";
    }) : false;
    return JSON.stringify({ gridData: gLen, richItems: richLen, debug, hasFake });
  })()`) as string) as { gridData: number; richItems: number; debug: string; hasFake: boolean };
  console.log(`${i+1}s: grid=${st.gridData} richItems=${st.richItems} hasFake=${st.hasFake} debug="${st.debug}"`);
  if (st.hasFake) {
    console.log("*** FAKE VIDEO FOUND IN POLYMER DATA! ***");
    break;
  }
  if (st.gridData > baseline.gridDataItems) {
    console.log(`*** GRID INCREASED: ${baseline.gridDataItems} → ${st.gridData} ***`);
    break;
  }
}

// Verify fake video is accessible via findItemElement
await new Promise(resolve => setTimeout(resolve, 1000));
const findResult = await evaluate(SUBS_ID, `(() => {
  // Check for the fake video in DOM
  for (const el of document.querySelectorAll("ytd-rich-item-renderer")) {
    if (!("data" in el)) continue;
    const data = el.data;
    const content = data?.content;
    if (content?.lockupViewModel?.contentId === "${FAKE_VIDEO_ID}" || content?.videoRenderer?.videoId === "${FAKE_VIDEO_ID}") {
      return JSON.stringify({ foundInDom: true, tagName: el.tagName, hasViewTransitionName: !!el.style?.viewTransitionName });
    }
  }
  // Check in Polymer grid data
  const grid = document.querySelector("ytd-rich-grid-renderer");
  const inPolymer = grid && "data" in grid && Array.isArray(grid.data?.contents) ?
    grid.data.contents.some(item => {
      const content = item?.richItemRenderer?.content;
      return content?.lockupViewModel?.contentId === "${FAKE_VIDEO_ID}" || content?.videoRenderer?.videoId === "${FAKE_VIDEO_ID}";
    }) : false;
  return JSON.stringify({ foundInDom: false, foundInPolymer: inPolymer });
})()`);
console.log("\nFinal check:", findResult);

// === TEST 2: Subscribe/unsubscribe with a currently-in-feed channel ===
console.log("\n=== TEST 2: Unsubscribe from a channel with videos in feed ===");
const channelSearch = await evaluate(SUBS_ID, `(() => {
  const grid = document.querySelector("ytd-rich-grid-renderer");
  if (!grid || !("data" in grid)) return JSON.stringify({ error: "no grid" });
  const contents = Array.isArray(grid.data?.contents) ? grid.data.contents : [];

  const channels = new Map();
  for (const item of contents) {
    const richItem = item?.richItemRenderer;
    if (!richItem?.content) continue;
    const content = richItem.content;

    if (content.lockupViewModel) {
      const lockup = content.lockupViewModel;
      const metaRows = lockup?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
      for (const row of metaRows) {
        for (const part of row?.metadataParts ?? []) {
          const channelId = part?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.browseId;
          if (channelId && !channels.has(channelId)) {
            channels.set(channelId, {
              channelId,
              videoId: lockup.contentId,
              title: lockup?.metadata?.lockupMetadataViewModel?.title?.content ?? ""
            });
          }
        }
      }
    }
    if (content.videoRenderer) {
      const channelId = content.videoRenderer?.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
      if (channelId && !channels.has(channelId)) {
        channels.set(channelId, {
          channelId,
          videoId: content.videoRenderer.videoId,
          title: content.videoRenderer?.title?.runs?.[0]?.text ?? ""
        });
      }
    }
  }

  return JSON.stringify([...channels.values()].slice(0, 3));
})()`);
const channels = JSON.parse(channelSearch as string) as Array<{ channelId: string; videoId: string; title: string }>;
console.log("Channels:", channels.map(c => `${c.channelId} - ${c.title.substring(0, 30)}`).join(", "));

const testChannel = channels[1] ?? channels[0];
if (!testChannel?.channelId) {
  console.log("No channel found for test 2");
  process.exit(0);
}

const currentGrid = JSON.parse(await evaluate(SUBS_ID, `(() => {
  const g = document.querySelector("ytd-rich-grid-renderer");
  const gLen = g && "data" in g ? (Array.isArray(g.data?.contents) ? g.data.contents.length : 0) : 0;
  const richLen = document.querySelectorAll("ytd-rich-item-renderer").length;
  return JSON.stringify({ gridData: gLen, richItems: richLen });
})()`) as string) as { gridData: number; richItems: number };
console.log(`\nCurrent state before unsubscribe: grid=${currentGrid.gridData} richItems=${currentGrid.richItems}`);
console.log(`Test channel: ${testChannel.channelId} - ${testChannel.title.substring(0, 40)}`);

const unsubResult = await evaluate(SUBS_ID, `(async () => {
  const config = yt?.config_;
  if (!config?.INNERTUBE_CONTEXT) return "no config";
  const cookiePair = document.cookie.split("; ").find(r => r.startsWith("SAPISID="));
  if (!cookiePair) return "no SAPISID";
  const sapisid = cookiePair.slice("SAPISID=".length);
  const ts = Math.floor(Date.now() / 1000);
  const hbuf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(ts + " " + sapisid + " https://www.youtube.com"));
  const auth = "SAPISIDHASH " + ts + "_" + Array.from(new Uint8Array(hbuf)).map(b => b.toString(16).padStart(2,"0")).join("");
  const resp = await fetch("/youtubei/v1/subscription/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": auth, "X-Goog-Authuser": "0", "X-Origin": "https://www.youtube.com" },
    body: JSON.stringify({ context: config.INNERTUBE_CONTEXT, channelIds: ["${testChannel.channelId}"] })
  });
  return JSON.stringify({ status: resp.status, ok: resp.ok });
})()`);
console.log("Unsubscribe result:", unsubResult);

let afterUnsubGrid = currentGrid.gridData;
let afterUnsubRich = currentGrid.richItems;
for (let i = 0; i < 15; i++) {
  await new Promise(resolve => setTimeout(resolve, 2000));
  const st = JSON.parse(await evaluate(SUBS_ID, `(() => {
    const g = document.querySelector("ytd-rich-grid-renderer");
    const gLen = g && "data" in g ? (Array.isArray(g.data?.contents) ? g.data.contents.length : 0) : 0;
    const richLen = document.querySelectorAll("ytd-rich-item-renderer").length;
    const debug = sessionStorage.getItem("ytsua-debug") ?? "(none)";
    return JSON.stringify({ gridData: gLen, richItems: richLen, debug });
  })()`) as string) as { gridData: number; richItems: number; debug: string };
  console.log(`${(i+1)*2}s: grid=${st.gridData} richItems=${st.richItems} debug="${st.debug}"`);
  if (st.gridData < currentGrid.gridData && st.gridData > 0) {
    afterUnsubGrid = st.gridData;
    afterUnsubRich = st.richItems;
    console.log(`*** REMOVAL: ${currentGrid.gridData} → ${afterUnsubGrid} (-${currentGrid.gridData - afterUnsubGrid}) richItems: ${currentGrid.richItems} → ${afterUnsubRich} ***`);
    break;
  }
}

// Re-subscribe
const resubResult = await evaluate(SUBS_ID, `(async () => {
  const config = yt?.config_;
  if (!config?.INNERTUBE_CONTEXT) return "no config";
  const cookiePair = document.cookie.split("; ").find(r => r.startsWith("SAPISID="));
  if (!cookiePair) return "no SAPISID";
  const sapisid = cookiePair.slice("SAPISID=".length);
  const ts = Math.floor(Date.now() / 1000);
  const hbuf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(ts + " " + sapisid + " https://www.youtube.com"));
  const auth = "SAPISIDHASH " + ts + "_" + Array.from(new Uint8Array(hbuf)).map(b => b.toString(16).padStart(2,"0")).join("");
  const resp = await fetch("/youtubei/v1/subscription/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": auth, "X-Goog-Authuser": "0", "X-Origin": "https://www.youtube.com" },
    body: JSON.stringify({ context: config.INNERTUBE_CONTEXT, channelIds: ["${testChannel.channelId}"] })
  });
  return JSON.stringify({ status: resp.status, ok: resp.ok });
})()`);
console.log("\nRe-subscribe result:", resubResult);

for (let i = 0; i < 15; i++) {
  await new Promise(resolve => setTimeout(resolve, 2000));
  const st = JSON.parse(await evaluate(SUBS_ID, `(() => {
    const g = document.querySelector("ytd-rich-grid-renderer");
    const gLen = g && "data" in g ? (Array.isArray(g.data?.contents) ? g.data.contents.length : 0) : 0;
    const richLen = document.querySelectorAll("ytd-rich-item-renderer").length;
    const debug = sessionStorage.getItem("ytsua-debug") ?? "(none)";
    return JSON.stringify({ gridData: gLen, richItems: richLen, debug });
  })()`) as string) as { gridData: number; richItems: number; debug: string };
  console.log(`${(i+1)*2}s: grid=${st.gridData} richItems=${st.richItems} debug="${st.debug}"`);
  if (st.gridData > afterUnsubGrid) {
    console.log(`*** RE-ADDITION: ${afterUnsubGrid} → ${st.gridData} (+${st.gridData - afterUnsubGrid}) ***`);
    break;
  }
}

console.log("\nDone.");
