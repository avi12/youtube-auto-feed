/**
 * Measures WHEN the survivor layout reflows after re-inserting a tile on Firefox.
 * Replays the production single-pass FLIP sequence: set reduced -> settle -> record oldRects ->
 * rAF{ set full + flush + measure delta } -> measure again +1 frame, +3 frames.
 *
 * If survivors have delta=0 in the same frame as set+flush but delta!=0 a frame later, the pin
 * (which runs in that same frame) computes a zero translate -> no glide -> survivors snap = glitch.
 */
import net from "net";

const FF_PORT = parseInt(process.argv[2] ?? "56517", 10);

const probeJs = `
(async () => {
  const elGrid = document.querySelector('ytd-rich-grid-renderer');
  if (!elGrid?.data?.contents?.length) { window.__r = JSON.stringify({ error: 'no grid' }); return; }

  const SEL = 'ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer';
  function vidFromData(d) {
    return d?.content?.videoRenderer?.videoId
      ?? d?.content?.lockupViewModel?.contentId
      ?? d?.content?.lockupViewModel?.videoId
      ?? d?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  }
  function vidFromItem(item) {
    return item?.richItemRenderer?.content?.videoRenderer?.videoId
      ?? item?.richItemRenderer?.content?.lockupViewModel?.contentId
      ?? item?.richItemRenderer?.content?.lockupViewModel?.videoId
      ?? item?.richItemRenderer?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  }
  const raf = () => new Promise(r => requestAnimationFrame(() => r()));

  const fullContents = [...elGrid.data.contents];
  let insertIndex = -1, insertId = null;
  for (let i = 0; i < fullContents.length; i++) {
    const v = vidFromItem(fullContents[i]);
    if (v) { insertIndex = i; insertId = v; break; }
  }
  if (!insertId) { window.__r = JSON.stringify({ error: 'no inline video' }); return; }

  const reducedContents = fullContents.filter((_, i) => i !== insertIndex);

  // 1) Settle DOM into the reduced (pre-insertion) state.
  elGrid.set('data.contents', reducedContents);
  if (globalThis.Polymer?.flush) globalThis.Polymer.flush();
  await raf(); await raf();

  // 2) Record survivor oldRects (in-viewport + 1200px below), production style.
  const inReflow = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight + 1200; };
  const oldRects = new Map();
  for (const el of document.querySelectorAll(SEL)) {
    if (!inReflow(el) || !('data' in el)) continue;
    const id = vidFromData(el.data);
    if (id) oldRects.set(id, el.getBoundingClientRect());
  }

  const CAP = 600;
  function measureDeltas() {
    let moved = 0, stuck = 0, overCap = 0, maxDist = 0; const all = [];
    for (const el of document.querySelectorAll(SEL)) {
      if (!('data' in el)) continue;
      const id = vidFromData(el.data);
      if (!id || id === insertId || !oldRects.has(id)) continue;
      const o = oldRects.get(id), n = el.getBoundingClientRect();
      const dy = o.top - n.top, dx = o.left - n.left;
      const d = Math.hypot(dx, dy);
      if (d >= 1) {
        moved++; maxDist = Math.max(maxDist, d);
        const exceedsCap = d > CAP;
        if (exceedsCap) overCap++;
        all.push({ id, dx: +dx.toFixed(0), dy: +dy.toFixed(0), dist: +d.toFixed(0), exceedsCap });
      } else stuck++;
    }
    return { moved, stuck, overCap, maxDist: +maxDist.toFixed(0), all };
  }

  // 3) Same frame as set+flush (exactly when pinSurvivorsToOldRects runs in production).
  const t0 = await new Promise(resolve => requestAnimationFrame(() => {
    elGrid.set('data.contents', fullContents);
    if (globalThis.Polymer?.flush) globalThis.Polymer.flush();
    resolve(measureDeltas());
  }));

  await raf();
  const t1 = measureDeltas();
  await raf(); await raf();
  const t3 = measureDeltas();

  window.__r = JSON.stringify({ insertId, insertIndex, survivorsTracked: oldRects.size,
    sameFrame: t0, plus1Frame: t1, plus3Frames: t3 });
})();
"ok"
`;

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
