/**
 * Triggers a REAL extension insertion on Firefox: force animations on (in MAIN memory), pause polling,
 * drop the front Latest video, then fetchFreshVideos() so the mirror re-inserts via setContentsWithFlip.
 * Returns immediately so the caller can screenshot the (slowed) animation.
 */
import net from "net";

const FF_PORT = parseInt(process.argv[2] ?? "56517", 10);

const js = `
(async () => {
  const elGrid = document.querySelector('ytd-rich-grid-renderer');
  const dbg = globalThis.__ytafDebug;
  if (!elGrid?.data?.contents?.length || !dbg) { window.__r = JSON.stringify({ error: 'no grid/debug' }); return; }
  window.dispatchEvent(new CustomEvent('@webext-core/messaging/custom-events', { detail: {
    namespace: 'ytaf-settings', instanceId: 'trig-' + Math.random(),
    message: { id: 1, type: 'settingsChanged', timestamp: Date.now(), data: { isExtensionEnabled: true, isAnimationsEnabled: true } } } }));
  const vidFromItem = i => i?.richItemRenderer?.content?.videoRenderer?.videoId ?? i?.richItemRenderer?.content?.lockupViewModel?.contentId ?? i?.richItemRenderer?.content?.lockupViewModel?.videoId ?? i?.richItemRenderer?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  dbg.pausePolling();
  const full = [...elGrid.data.contents];
  let idx = -1, insertId = null;
  for (let i = 0; i < full.length; i++) { const v = vidFromItem(full[i]); if (v) { idx = i; insertId = v; break; } }
  if (!insertId) { window.__r = JSON.stringify({ error: 'no inline' }); return; }
  elGrid.set('data.contents', full.filter((_, i) => i !== idx));
  if (globalThis.Polymer?.flush) globalThis.Polymer.flush();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  dbg.fetchFreshVideos().catch(() => {});
  window.__r = JSON.stringify({ started: true, insertId });
})();
"ok"
`;

const result = await evalDirectAsync(FF_PORT, js);
console.log(JSON.stringify(result));

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
        if (phase === "running") { phase = "polling"; setTimeout(poll, 150); return; }
        if (phase === "polling") { const raw = xs(pkt.result); if (raw) { socket.destroy(); try { resolve(JSON.parse(raw)); } catch (_) { resolve(raw); } } else setTimeout(poll, 100); }
      }
    }
    socket.on("data", chunk => { rawBuf = Buffer.concat([rawBuf, chunk]); for (const p of rp()) handle(p); });
    socket.on("error", reject);
    setTimeout(() => { socket.destroy(); reject(new Error("Timeout")); }, 30000);
  });
}
