/**
 * Verifies the real extension insertion animation on Firefox.
 * Eval A: pause polling, drop the front Latest video, record reduced-state rects, start a detached
 *   sampler that classifies each survivor as glided (animated translate) / faded (data-ytaf-reflow-fade
 *   + opacity ramp), then fire fetchFreshVideos() so the mirror re-inserts via setContentsWithFlip.
 * Eval B (after settle): compute final rects, cross-check distance vs classification, resume polling.
 */
import net from "net";

const FF_PORT = parseInt(process.argv[2] ?? "56517", 10);

const evalA = `
(async () => {
  const elGrid = document.querySelector('ytd-rich-grid-renderer');
  const dbg = globalThis.__ytafDebug;
  if (!elGrid?.data?.contents?.length || !dbg) { window.__ytafV = { error: 'no grid/debug' }; return; }

  // Force animations ON in MAIN-world memory for this test (mimics the settings bridge broadcast).
  window.dispatchEvent(new CustomEvent('@webext-core/messaging/custom-events', { detail: {
    namespace: 'ytaf-settings', instanceId: 'verify-' + Math.random(),
    message: { id: 1, type: 'settingsChanged', timestamp: Date.now(),
      data: { isExtensionEnabled: true, isAnimationsEnabled: true } }
  } }));

  const SEL = 'ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer';
  const vidFromData = d => d?.content?.videoRenderer?.videoId ?? d?.content?.lockupViewModel?.contentId ?? d?.content?.lockupViewModel?.videoId ?? d?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  const vidFromItem = i => i?.richItemRenderer?.content?.videoRenderer?.videoId ?? i?.richItemRenderer?.content?.lockupViewModel?.contentId ?? i?.richItemRenderer?.content?.lockupViewModel?.videoId ?? i?.richItemRenderer?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  const raf = () => new Promise(r => requestAnimationFrame(() => r()));
  const inReflow = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight + 1200; };

  dbg.pausePolling();

  const full = [...elGrid.data.contents];
  let idx = -1, insertId = null;
  for (let i = 0; i < full.length; i++) { const v = vidFromItem(full[i]); if (v) { idx = i; insertId = v; break; } }
  if (!insertId) { window.__ytafV = { error: 'no inline video' }; return; }

  elGrid.set('data.contents', full.filter((_, i) => i !== idx));
  if (globalThis.Polymer?.flush) globalThis.Polymer.flush();
  await raf(); await raf();

  const reduced = {};
  for (const el of document.querySelectorAll(SEL)) { if (!inReflow(el) || !('data' in el)) continue; const id = vidFromData(el.data); if (id && id !== insertId) { const r = el.getBoundingClientRect(); reduced[id] = { top: r.top, left: r.left }; } }

  const track = {};
  const V = window.__ytafV = { insertId, reduced, track, frames: 0, done: false };

  let frames = 0;
  V.insertedSawNewClass = false;
  V.insertedMinOp = 1;
  const sampler = () => {
    frames++;
    for (const el of document.querySelectorAll(SEL)) {
      if (!('data' in el)) continue;
      const id = vidFromData(el.data);
      if (id === insertId) {
        if (el.classList.contains('ytaf-new')) V.insertedSawNewClass = true;
        const iop = parseFloat(getComputedStyle(el).opacity);
        if (iop < V.insertedMinOp) V.insertedMinOp = iop;
        continue;
      }
      if (!id || !(id in reduced)) continue;
      const cs = getComputedStyle(el);
      const tr = cs.translate;
      const op = parseFloat(cs.opacity);
      const hasTranslate = tr && tr !== 'none' && tr !== '0px' && tr !== '0px 0px';
      const hasFadeAttr = el.dataset.ytafReflowFade === '1' || el.hasAttribute('data-ytaf-reflow-fade');
      const t = track[id] ?? (track[id] = { sawTranslate: false, sawFade: false, minOp: 1 });
      if (hasTranslate) t.sawTranslate = true;
      if (hasFadeAttr) t.sawFade = true;
      if (op < t.minOp) t.minOp = op;
    }
    V.frames = frames;
    if (frames < 150) requestAnimationFrame(sampler); else V.done = true;
  };
  requestAnimationFrame(sampler);

  // Fire the real re-insertion (mirror re-adds the dropped video from the API).
  dbg.fetchFreshVideos().catch(() => {});
  window.__r = JSON.stringify({ started: true, insertId });
})();
"ok"
`;

const evalB = `
(() => {
  const V = window.__ytafV;
  if (!V || V.error) { window.__r = JSON.stringify(V ?? { error: 'no V' }); return; }
  const SEL = 'ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer';
  const vidFromData = d => d?.content?.videoRenderer?.videoId ?? d?.content?.lockupViewModel?.contentId ?? d?.content?.lockupViewModel?.videoId ?? d?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  const finalRects = {};
  for (const el of document.querySelectorAll(SEL)) { if (!('data' in el)) continue; const id = vidFromData(el.data); if (id) { const r = el.getBoundingClientRect(); finalRects[id] = { top: r.top, left: r.left }; } }

  const glided = [], faded = [], snapped = [], unmoved = [];
  for (const id of Object.keys(V.reduced)) {
    const o = V.reduced[id], n = finalRects[id];
    if (!n) continue;
    const dist = Math.hypot(o.left - n.left, o.top - n.top);
    const t = V.track[id] ?? { sawTranslate: false, sawFade: false, minOp: 1 };
    const rec = { id, dist: +dist.toFixed(0), minOp: +t.minOp.toFixed(2) };
    if (dist < 1) unmoved.push(rec);
    else if (t.sawFade) faded.push(rec);
    else if (t.sawTranslate) glided.push(rec);
    else snapped.push(rec);
  }
  globalThis.__ytafDebug?.resumePolling();
  window.__r = JSON.stringify({
    insertId: V.insertId, samplerFrames: V.frames, samplerDone: V.done,
    insertedSawNewClass: V.insertedSawNewClass, insertedMinOp: +(V.insertedMinOp ?? 1).toFixed(2),
    counts: { glided: glided.length, faded: faded.length, snapped: snapped.length, unmoved: unmoved.length },
    glided: glided.slice(0, 6), faded: faded.slice(0, 6), snapped,
  });
})()
`;

const startRes = await evalDirectAsync(FF_PORT, evalA);
console.log("start:", JSON.stringify(startRes));
await new Promise(r => setTimeout(r, 4000));
const result = await evalDirectAsync(FF_PORT, evalB);
console.log(JSON.stringify(result, null, 2));

function evalDirectAsync(port, code) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    let rawBuf = Buffer.alloc(0);
    let consoleActor = null, phase = "init";
    function send(obj) { const j = JSON.stringify(obj); const b = Buffer.from(j); socket.write(`${b.byteLength}:${j}`); }
    function rp() { const p = []; while (true) { const s = rawBuf.toString("utf8"), c = s.indexOf(":"); if (c === -1) break; const len = parseInt(s.slice(0, c), 10); if (isNaN(len)) { rawBuf = Buffer.from(s.slice(c + 1)); continue; } const body = Buffer.from(s.slice(c + 1)); if (body.byteLength < len) break; rawBuf = body.slice(len); try { p.push(JSON.parse(body.slice(0, len).toString())); } catch (_) {} } return p; }
    function xs(r) { if (typeof r === "string" && r && r !== "ok") return r; if (r?.value && typeof r.value === "string" && r.value !== "ok") return r.value; return null; }
    function poll() { send({ to: consoleActor, type: "evaluateJSAsync", text: "window.__r || ''" }); }
    function handle(pkt) {
      if (pkt.error) { socket.destroy(); reject(new Error(pkt.error)); return; }
      if (phase === "init" && pkt.applicationType) { phase = "listing"; send({ to: "root", type: "listTabs" }); return; }
      if (phase === "listing" && pkt.tabs) { phase = "targeting"; const t = pkt.tabs.find(t => t.url?.includes("youtube.com/feed/subscriptions")) ?? pkt.tabs[0]; send({ to: t.actor, type: "getTarget" }); return; }
      if (phase === "targeting" && pkt.frame?.consoleActor) { phase = "running"; consoleActor = pkt.frame.consoleActor; send({ to: consoleActor, type: "evaluateJSAsync", text: `window.__r = undefined; ${code}` }); return; }
      if (pkt.type === "evaluationResult") {
        if (phase === "running") { phase = "polling"; setTimeout(poll, 200); return; }
        if (phase === "polling") { const raw = xs(pkt.result); if (raw) { socket.destroy(); try { resolve(JSON.parse(raw)); } catch (_) { resolve(raw); } } else setTimeout(poll, 150); }
      }
    }
    socket.on("data", chunk => { rawBuf = Buffer.concat([rawBuf, chunk]); for (const p of rp()) handle(p); });
    socket.on("error", reject);
    setTimeout(() => { socket.destroy(); reject(new Error("Timeout")); }, 30000);
  });
}
