/**
 * Better probe: finds a video that IS present in el.data on DOM nodes, removes it, and measures settle.
 * Also checks Edge for comparison.
 */
import net from "net";
import { evalInFirefox } from "./firefox-rdp-lib.mjs";

const FF_PORT = parseInt(process.argv[2] ?? "56517", 10);

const probeCode = `
(async () => {
  const elGrid = document.querySelector('ytd-rich-grid-renderer');
  if (!elGrid?.data?.contents?.length) { window.__r = JSON.stringify({ error: 'no grid' }); return; }

  function videoIdFromDomData(data) {
    return data?.content?.videoRenderer?.videoId
      ?? data?.content?.lockupViewModel?.contentId
      ?? data?.content?.lockupViewModel?.videoId
      ?? data?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
      ?? null;
  }

  // Read actual DOM video IDs from el.data
  function inlineDomIds() {
    return [...document.querySelectorAll('ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer')]
      .map(el => ('data' in el ? videoIdFromDomData(el.data) : null))
      .filter(Boolean);
  }

  const domIdsBefore = inlineDomIds();
  const currentContents = elGrid.data.contents;

  // Find the first DOM video in currentContents (guaranteed to be in DOM)
  const firstDomId = domIdsBefore[0];
  if (!firstDomId) { window.__r = JSON.stringify({ error: 'no DOM items', domCount: domIdsBefore.length }); return; }

  // Build newContents by removing that specific video from currentContents
  function videoIdFromItem(item) {
    return item?.richItemRenderer?.content?.videoRenderer?.videoId
      ?? item?.richItemRenderer?.content?.lockupViewModel?.contentId
      ?? item?.richItemRenderer?.content?.lockupViewModel?.videoId
      ?? item?.richItemRenderer?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
      ?? null;
  }

  const removalIndex = currentContents.findIndex(item => videoIdFromItem(item) === firstDomId);
  if (removalIndex === -1) { window.__r = JSON.stringify({ error: 'video not in contents', firstDomId }); return; }

  const newContents = currentContents.filter((_, i) => i !== removalIndex);
  const expectedIds = newContents.map(videoIdFromItem).filter(Boolean);
  const expectedIdsStr = expectedIds.join(',');

  const t0 = performance.now();
  elGrid.set('data.contents', newContents);
  const afterSetMs = performance.now() - t0;

  if (globalThis.Polymer?.flush) globalThis.Polymer.flush();
  const afterFlushMs = performance.now() - t0;

  const afterFlushIds = inlineDomIds();
  const afterFlushIdsStr = afterFlushIds.join(',');
  const settledAfterFlush = afterFlushIdsStr === expectedIdsStr;

  // Check if removed ID disappeared
  const removedGone = !afterFlushIds.includes(firstDomId);

  let frames = 0;
  let settledAt = settledAfterFlush ? 0 : -1;
  const frameSamples = [];
  const MAX_FRAMES = 30;

  if (!settledAfterFlush) {
    await new Promise(resolve => {
      function tick() {
        frames++;
        const ids = inlineDomIds();
        const idsStr = ids.join(',');
        const matches = idsStr === expectedIdsStr;
        frameSamples.push({ frame: frames, count: ids.length, removedGone: !ids.includes(firstDomId), matches });
        if (matches) { settledAt = frames; resolve(); return; }
        if (frames < MAX_FRAMES) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
  }

  // Restore
  elGrid.set('data.contents', currentContents);

  window.__r = JSON.stringify({
    removedId: firstDomId,
    domBeforeCount: domIdsBefore.length,
    expectedCount: expectedIds.length,
    afterSetMs: +afterSetMs.toFixed(2),
    afterFlushMs: +afterFlushMs.toFixed(2),
    settledAfterFlush,
    removedGoneAfterFlush: removedGone,
    afterFlushCount: afterFlushIds.length,
    settledAt,
    frameSamples
  });
})();
"probe-started"
`;

console.log("Running Firefox probe...");
const ffResult = await evalDirectAsync(FF_PORT, probeCode);
console.log("Firefox:", JSON.stringify(ffResult, null, 2));

function evalDirectAsync(port, code) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    let rawBuf = Buffer.alloc(0);
    let consoleActor = null;
    let phase = "init";

    function send(obj) {
      const json = JSON.stringify(obj);
      const buf = Buffer.from(json, "utf8");
      socket.write(`${buf.byteLength}:${json}`);
    }

    function readPackets() {
      const pkts = [];
      while (true) {
        const str = rawBuf.toString("utf8");
        const colon = str.indexOf(":");
        if (colon === -1) break;
        const len = parseInt(str.slice(0, colon), 10);
        if (isNaN(len)) { rawBuf = Buffer.from(str.slice(colon + 1), "utf8"); continue; }
        const bodyBuf = Buffer.from(str.slice(colon + 1), "utf8");
        if (bodyBuf.byteLength < len) break;
        rawBuf = bodyBuf.slice(len);
        try { pkts.push(JSON.parse(bodyBuf.slice(0, len).toString("utf8"))); } catch (_) {}
      }
      return pkts;
    }

    function extractString(result) {
      if (typeof result === "string" && result !== "" && result !== "probe-started") return result;
      if (result && typeof result === "object") {
        const v = result.value ?? result.displayString ?? "";
        if (typeof v === "string" && v !== "" && v !== "probe-started") return v;
      }
      return null;
    }

    function poll() { send({ to: consoleActor, type: "evaluateJSAsync", text: "window.__r || ''" }); }

    function handle(pkt) {
      if (pkt.error) { socket.destroy(); reject(new Error(`RDP: ${pkt.error}`)); return; }
      if (phase === "init" && pkt.applicationType) { phase = "listing"; send({ to: "root", type: "listTabs" }); return; }
      if (phase === "listing" && pkt.tabs) {
        phase = "targeting";
        const tab = pkt.tabs.find(t => t.url?.includes("youtube.com/feed/subscriptions")) ?? pkt.tabs[0];
        send({ to: tab.actor, type: "getTarget" }); return;
      }
      if (phase === "targeting" && pkt.frame?.consoleActor) {
        phase = "running"; consoleActor = pkt.frame.consoleActor;
        send({ to: consoleActor, type: "evaluateJSAsync", text: `window.__r = undefined; ${code}` });
        return;
      }
      if (pkt.type === "evaluationResult") {
        if (phase === "running") { phase = "polling"; setTimeout(poll, 300); return; }
        if (phase === "polling") {
          const raw = extractString(pkt.result);
          if (raw) { socket.destroy(); try { resolve(JSON.parse(raw)); } catch (_) { resolve(raw); } }
          else setTimeout(poll, 200);
        }
      }
    }

    socket.on("data", chunk => { rawBuf = Buffer.concat([rawBuf, chunk]); for (const pkt of readPackets()) handle(pkt); });
    socket.on("error", reject);
    setTimeout(() => { socket.destroy(); reject(new Error("Timeout")); }, 40000);
  });
}
