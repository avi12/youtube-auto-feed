/**
 * Correct layout probe: tracks survivors by video ID across the removal.
 * After set+flush, finds each survivor's new DOM node and compares position.
 */
import net from "net";

const FF_PORT = parseInt(process.argv[2] ?? "56517", 10);

const probeJs = `
(async () => {
  const elGrid = document.querySelector('ytd-rich-grid-renderer');
  if (!elGrid?.data?.contents?.length) { window.__r = JSON.stringify({ error: 'no grid' }); return; }

  function videoIdFromDomData(d) {
    return d?.content?.videoRenderer?.videoId
      ?? d?.content?.lockupViewModel?.contentId
      ?? d?.content?.lockupViewModel?.videoId
      ?? d?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  }
  function videoIdFromItem(item) {
    return item?.richItemRenderer?.content?.videoRenderer?.videoId
      ?? item?.richItemRenderer?.content?.lockupViewModel?.contentId
      ?? item?.richItemRenderer?.content?.lockupViewModel?.videoId
      ?? item?.richItemRenderer?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  }

  const elItems = [...document.querySelectorAll('ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer')];
  const currentContents = [...elGrid.data.contents];

  // Build id → old rect map for ALL DOM items
  const oldRectById = new Map();
  for (const el of elItems) {
    const id = 'data' in el ? videoIdFromDomData(el.data) : null;
    if (id) oldRectById.set(id, el.getBoundingClientRect());
  }

  // Find the first DOM video in currentContents
  let targetId = null, removalIndex = -1;
  for (let i = 0; i < currentContents.length; i++) {
    const vid = videoIdFromItem(currentContents[i]);
    if (vid && oldRectById.has(vid)) { targetId = vid; removalIndex = i; break; }
  }
  if (!targetId) { window.__r = JSON.stringify({ error: 'no target', domCount: oldRectById.size }); return; }

  const newContents = currentContents.filter((_, i) => i !== removalIndex);
  const tSet = performance.now();
  elGrid.set('data.contents', newContents);
  const setMs = +(performance.now() - tSet).toFixed(1);
  if (globalThis.Polymer?.flush) globalThis.Polymer.flush();
  const flushMs = +(performance.now() - tSet).toFixed(1);

  // After flush: find each survivor's new node and compare positions
  const movedSurvivors = [];
  const stuckSurvivors = [];
  const noNodeFound = [];

  for (const el of document.querySelectorAll('ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer')) {
    if (!('data' in el)) continue;
    const id = videoIdFromDomData(el.data);
    if (!id || id === targetId || !oldRectById.has(id)) continue;
    const oldRect = oldRectById.get(id);
    const newRect = el.getBoundingClientRect();
    const dy = newRect.top - oldRect.top;
    const dx = newRect.left - oldRect.left;
    if (Math.abs(dy) >= 1 || Math.abs(dx) >= 1) {
      movedSurvivors.push({ id, oldY: +oldRect.top.toFixed(0), newY: +newRect.top.toFixed(0), dy: +dy.toFixed(0) });
    } else {
      stuckSurvivors.push({ id, y: +newRect.top.toFixed(0) });
    }
  }

  // Videos that had old rects but no node found after flush
  const afterIds = new Set([...document.querySelectorAll('ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer')]
    .map(el => ('data' in el ? videoIdFromDomData(el.data) : null)).filter(Boolean));
  for (const [id] of oldRectById) {
    if (id !== targetId && !afterIds.has(id)) noNodeFound.push(id);
  }

  // Also check: is target video gone from DOM?
  const targetGone = !afterIds.has(targetId);

  elGrid.set('data.contents', currentContents);

  window.__r = JSON.stringify({
    targetId, setMs, flushMs, targetGone,
    domCountBefore: oldRectById.size,
    domCountAfter: afterIds.size,
    movedCount: movedSurvivors.length,
    stuckCount: stuckSurvivors.length,
    noNodeCount: noNodeFound.length,
    movedSamples: movedSurvivors.slice(0, 5),
    stuckSamples: stuckSurvivors.slice(0, 5),
    layoutUpdatedSynchronously: movedSurvivors.length > 0
  });
})();
"ok"
`;

console.log("Firefox layout probe...");
const result = await evalDirectAsync(FF_PORT, probeJs);
console.log(JSON.stringify(result, null, 2));

function evalDirectAsync(port, code) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    let rawBuf = Buffer.alloc(0);
    let consoleActor = null, phase = "init";
    function send(obj) { const j = JSON.stringify(obj); const b = Buffer.from(j); socket.write(`${b.byteLength}:${j}`); }
    function rp() {
      const p = [];
      while (true) {
        const s = rawBuf.toString("utf8"), c = s.indexOf(":");
        if (c === -1) break;
        const len = parseInt(s.slice(0, c), 10);
        if (isNaN(len)) { rawBuf = Buffer.from(s.slice(c + 1)); continue; }
        const body = Buffer.from(s.slice(c + 1));
        if (body.byteLength < len) break;
        rawBuf = body.slice(len);
        try { p.push(JSON.parse(body.slice(0, len).toString())); } catch (_) {}
      }
      return p;
    }
    function xs(r) {
      if (typeof r === "string" && r && r !== "ok") return r;
      if (r?.value && typeof r.value === "string" && r.value !== "ok") return r.value;
      return null;
    }
    function poll() { send({ to: consoleActor, type: "evaluateJSAsync", text: "window.__r || ''" }); }
    function handle(pkt) {
      if (pkt.error) { socket.destroy(); reject(new Error(pkt.error)); return; }
      if (phase === "init" && pkt.applicationType) { phase = "listing"; send({ to: "root", type: "listTabs" }); return; }
      if (phase === "listing" && pkt.tabs) { phase = "targeting"; const t = pkt.tabs.find(t => t.url?.includes("youtube.com/feed/subscriptions")) ?? pkt.tabs[0]; send({ to: t.actor, type: "getTarget" }); return; }
      if (phase === "targeting" && pkt.frame?.consoleActor) { phase = "running"; consoleActor = pkt.frame.consoleActor; send({ to: consoleActor, type: "evaluateJSAsync", text: `window.__r = undefined; ${code}` }); return; }
      if (pkt.type === "evaluationResult") {
        if (phase === "running") { phase = "polling"; setTimeout(poll, 300); return; }
        if (phase === "polling") { const raw = xs(pkt.result); if (raw) { socket.destroy(); try { resolve(JSON.parse(raw)); } catch (_) { resolve(raw); } } else setTimeout(poll, 200); }
      }
    }
    socket.on("data", chunk => { rawBuf = Buffer.concat([rawBuf, chunk]); for (const p of rp()) handle(p); });
    socket.on("error", reject);
    setTimeout(() => { socket.destroy(); reject(new Error("Timeout")); }, 40000);
  });
}
