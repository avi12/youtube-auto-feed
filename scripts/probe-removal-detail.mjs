/**
 * Detailed real-path REMOVAL observation on Firefox. Injects a bogus-id clone of the front Latest tile
 * so the next fetchFreshVideos removes it through the real mirror, then samples per frame: the ghost
 * (opacity/scale/top/left), the survivor glide, and the gap, to find the removal glitch.
 */
import net from "net";

const FF_PORT = parseInt(process.argv[2] ?? "56517", 10);

const evalA = `
(async () => {
  const elGrid = document.querySelector('ytd-rich-grid-renderer');
  const dbg = globalThis.__ytafDebug;
  if (!elGrid?.data?.contents?.length || !dbg) { window.__ytafR = { error: 'no grid/debug' }; return; }
  window.dispatchEvent(new CustomEvent('@webext-core/messaging/custom-events', { detail: {
    namespace: 'ytaf-settings', instanceId: 'r-' + Math.random(),
    message: { id: 1, type: 'settingsChanged', timestamp: Date.now(), data: { isExtensionEnabled: true, isAnimationsEnabled: true } } } }));
  const SEL = 'ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer';
  const GHOST = '[data-ytaf-removal-ghost]';
  const vidFromData = d => d?.content?.videoRenderer?.videoId ?? d?.content?.lockupViewModel?.contentId ?? d?.content?.lockupViewModel?.videoId ?? d?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  const vidFromItem = i => i?.richItemRenderer?.content?.videoRenderer?.videoId ?? i?.richItemRenderer?.content?.lockupViewModel?.contentId ?? i?.richItemRenderer?.content?.lockupViewModel?.videoId ?? i?.richItemRenderer?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  const raf = () => new Promise(r => requestAnimationFrame(() => r()));
  const inReflow = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight + 1200; };

  dbg.pausePolling();

  // Build a bogus clone of the front Latest tile so it gets REMOVED on the next fetch (API lacks it).
  const full = [...elGrid.data.contents];
  let idx = -1; for (let i = 0; i < full.length; i++) { if (vidFromItem(full[i])) { idx = i; break; } }
  if (idx === -1) { window.__ytafR = { error: 'no inline' }; return; }
  const FAKE = 'FAKEREMOVAL1';
  let clone;
  try { clone = structuredClone(full[idx]); } catch (e) { clone = JSON.parse(JSON.stringify(full[idx])); }
  const c = clone.richItemRenderer.content;
  if (c.videoRenderer) c.videoRenderer.videoId = FAKE;
  if (c.lockupViewModel) { if ('contentId' in c.lockupViewModel) c.lockupViewModel.contentId = FAKE; if ('videoId' in c.lockupViewModel) c.lockupViewModel.videoId = FAKE; }
  // Force non-collaborative so the mirror drops it on the first absent poll (no sticky buffer).
  const meta = c.lockupViewModel?.metadata?.lockupMetadataViewModel?.image;
  if (meta?.avatarStackViewModel) delete meta.avatarStackViewModel;
  const withFake = [...full];
  withFake.splice(idx, 0, clone);
  elGrid.set('data.contents', withFake);
  if (globalThis.Polymer?.flush) globalThis.Polymer.flush();
  await raf(); await raf(); await raf();

  const fakeTile = [...document.querySelectorAll(SEL)].find(el => ('data' in el) && vidFromData(el.data) === FAKE) || null;
  const fakeRect = fakeTile ? fakeTile.getBoundingClientRect() : null;
  const slot = fakeRect ? { cx: fakeRect.left + fakeRect.width / 2, cy: fakeRect.top + Math.min(fakeRect.height, 180) / 2 } : null;
  const rectHas = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

  // Survivor baseline (positions WITH the fake present = pre-removal).
  const survRects = {};
  for (const el of document.querySelectorAll(SEL)) { if (!inReflow(el) || !('data' in el)) continue; const id = vidFromData(el.data); if (id && id !== FAKE) { const r = el.getBoundingClientRect(); survRects[id] = { top: r.top, left: r.left }; } }
  const survTrack = {};

  const avatars = clone?.richItemRenderer?.content?.lockupViewModel?.metadata?.lockupMetadataViewModel?.image?.avatarStackViewModel?.avatars;
  const fakeCollaborative = (avatars?.length ?? 0) > 1;

  const R = window.__ytafR = { fake: FAKE, fakeStamped: !!fakeTile, fakeCollaborative, fakeRect: fakeRect ? { top: Math.round(fakeRect.top), left: Math.round(fakeRect.left) } : null,
    frames: 0, polls: 0, ghostFirstFrame: -1, ghostLastFrame: -1, ghostMaxCount: 0, ghostSamples: [], fakeTileGoneFrame: -1,
    uncoveredFrames: [], slotEverActive: false, done: false };

  let frame = 0;
  const sampler = () => {
    frame++; R.frames = frame;
    const ghosts = document.querySelectorAll(GHOST);
    if (ghosts.length > 0) {
      if (R.ghostFirstFrame === -1) R.ghostFirstFrame = frame;
      R.ghostLastFrame = frame;
      if (ghosts.length > R.ghostMaxCount) R.ghostMaxCount = ghosts.length;
      const g = ghosts[0];
      const cs = getComputedStyle(g); const r = g.getBoundingClientRect();
      if (frame % 4 === 0 || R.ghostSamples.length < 3) R.ghostSamples.push({ f: frame, op: +parseFloat(cs.opacity).toFixed(2), sc: cs.scale === 'none' ? 1 : +parseFloat(cs.scale).toFixed(2), top: Math.round(r.top), left: Math.round(r.left) });
    }
    const fakeStill = [...document.querySelectorAll(SEL)].some(el => ('data' in el) && vidFromData(el.data) === FAKE);
    if (!fakeStill && R.fakeTileGoneFrame === -1) R.fakeTileGoneFrame = frame;

    // Slot-coverage check: once the fake tile is gone, the slot must stay covered by either the ghost
    // (opacity > 0.4) or a survivor tile sliding over it. A frame covered by neither = visible flash.
    if (slot && !fakeStill && R.fakeTileGoneFrame !== -1) {
      const g = ghosts[0];
      const ghostCovers = !!g && parseFloat(getComputedStyle(g).opacity) > 0.4 && rectHas(g.getBoundingClientRect(), slot.cx, slot.cy);
      let survivorCovers = false;
      for (const el of document.querySelectorAll(SEL)) { if (rectHas(el.getBoundingClientRect(), slot.cx, slot.cy)) { survivorCovers = true; break; } }
      R.slotEverActive = true;
      if (!ghostCovers && !survivorCovers) R.uncoveredFrames.push({ f: frame, ghostOp: g ? +parseFloat(getComputedStyle(g).opacity).toFixed(2) : null });
    }
    for (const el of document.querySelectorAll(SEL)) {
      if (!('data' in el)) continue;
      const id = vidFromData(el.data);
      if (!id || id === FAKE || !(id in survRects)) continue;
      const tr = getComputedStyle(el).translate;
      if (tr && tr !== 'none' && tr !== '0px' && tr !== '0px 0px') survTrack[id] = true;
    }
    if (frame < 200) requestAnimationFrame(sampler); else { R.survivorsGlided = Object.keys(survTrack).length; R.survivorsTracked = Object.keys(survRects).length; R.done = true; }
  };
  requestAnimationFrame(sampler);

  window.__r = JSON.stringify({ started: true, fakeStamped: !!fakeTile, fakeCollaborative });
  // Fire several polls (sticky collaborative removal needs up to STICKY_DELETE_POLLS=4 absent polls).
  (async () => {
    for (let p = 0; p < 6; p++) {
      R.polls = p + 1;
      await dbg.fetchFreshVideos().catch(() => {});
      await raf();
      if (R.fakeTileGoneFrame !== -1) break;
    }
  })();
})();
"ok"
`;

const evalB = `
(() => {
  const R = window.__ytafR;
  if (!R || R.error) { window.__r = JSON.stringify(R ?? { error: 'no R' }); return; }
  globalThis.__ytafDebug?.resumePolling();
  window.__r = JSON.stringify(R);
})()
`;

const startRes = await evalDirectAsync(FF_PORT, evalA);
console.log("start:", JSON.stringify(startRes));
await new Promise(r => setTimeout(r, 4500));
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
