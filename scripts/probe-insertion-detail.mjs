/**
 * Detailed real-path insertion observation on Firefox. Drops the front Latest video, re-inserts via
 * fetchFreshVideos, and samples (per frame) the NEW tile's presence/opacity/scale/entrance-class/image
 * plus how long until it first appears, and whether survivors glide. Reveals whether the decode-gate
 * freezes the insertion or the entrance fails.
 */
import net from "net";

const FF_PORT = parseInt(process.argv[2] ?? "56517", 10);
const POLL_FIRST_MS = 200;
const POLL_RETRY_MS = 150;
const TIMEOUT_MS = 30000;
const SETTLE_MS = 4500;

const START_JS = `
(async () => {
  const elGrid = document.querySelector('ytd-rich-grid-renderer');
  const dbg = globalThis.__ytafDebug;
  if (!elGrid?.data?.contents?.length || !dbg) { window.__ytafD = { error: 'no grid/debug' }; return; }
  const animOn = dbg.isAnimationsEnabled ? dbg.isAnimationsEnabled() : 'unknown';
  const SEL = 'ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer';
  const vidFromData = d => d?.content?.videoRenderer?.videoId ?? d?.content?.lockupViewModel?.contentId ?? d?.content?.lockupViewModel?.videoId ?? d?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  const vidFromItem = i => i?.richItemRenderer?.content?.videoRenderer?.videoId ?? i?.richItemRenderer?.content?.lockupViewModel?.contentId ?? i?.richItemRenderer?.content?.lockupViewModel?.videoId ?? i?.richItemRenderer?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  const raf = () => new Promise(r => requestAnimationFrame(() => r()));
  const inReflow = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight + 1200; };
  const findTile = id => [...document.querySelectorAll(SEL)].find(el => ('data' in el) && vidFromData(el.data) === id) || null;
  const thumbImg = el => el?.querySelector('img');

  dbg.pausePolling();
  const full = [...elGrid.data.contents];
  let idx = -1, insertId = null;
  for (let i = 0; i < full.length; i++) { const v = vidFromItem(full[i]); if (v) { idx = i; insertId = v; break; } }
  if (!insertId) { window.__ytafD = { error: 'no inline' }; return; }

  // Survivor baseline rects (reduced state) to detect glide.
  elGrid.set('data.contents', full.filter((_, i) => i !== idx));
  if (globalThis.Polymer?.flush) globalThis.Polymer.flush();
  await raf(); await raf();
  const survRects = {};
  for (const el of document.querySelectorAll(SEL)) { if (!inReflow(el) || !('data' in el)) continue; const id = vidFromData(el.data); if (id && id !== insertId) { const r = el.getBoundingClientRect(); survRects[id] = { top: r.top, left: r.left }; } }
  const survTrack = {};

  const D = window.__ytafD = { insertId, animOn, frames: 0, firstAppearFrame: -1, newClassFrame: -1,
    newMinOpacity: 1, newMinScale: 1, newFinalOpacity: null, newImgLoadedFrame: -1, samples: [], done: false };

  let frame = 0;
  const sampler = () => {
    frame++; D.frames = frame;
    const tile = findTile(insertId);
    if (tile) {
      if (D.firstAppearFrame === -1) D.firstAppearFrame = frame;
      const cs = getComputedStyle(tile);
      const op = parseFloat(cs.opacity);
      const sc = cs.scale === 'none' ? 1 : parseFloat(cs.scale);
      if (op < D.newMinOpacity) D.newMinOpacity = op;
      if (!isNaN(sc) && sc < D.newMinScale) D.newMinScale = sc;
      if (tile.classList.contains('ytaf-new') && D.newClassFrame === -1) D.newClassFrame = frame;
      const img = thumbImg(tile);
      if (img && img.naturalWidth > 0 && D.newImgLoadedFrame === -1) D.newImgLoadedFrame = frame;
      D.newFinalOpacity = +op.toFixed(2);
      if (frame % 10 === 0 || frame < 5) D.samples.push({ f: frame, op: +op.toFixed(2), sc: +(isNaN(sc)?1:sc).toFixed(2), nc: tile.classList.contains('ytaf-new'), img: !!(img && img.naturalWidth > 0) });
    }
    for (const el of document.querySelectorAll(SEL)) {
      if (!('data' in el)) continue;
      const id = vidFromData(el.data);
      if (!id || id === insertId || !(id in survRects)) continue;
      const tr = getComputedStyle(el).translate;
      const hasTr = tr && tr !== 'none' && tr !== '0px' && tr !== '0px 0px';
      if (hasTr) survTrack[id] = true;
    }
    if (frame < 200) requestAnimationFrame(sampler); else { D.survivorsGlided = Object.keys(survTrack).length; D.survivorsTracked = Object.keys(survRects).length; D.done = true; }
  };
  requestAnimationFrame(sampler);

  const t0 = performance.now();
  dbg.fetchFreshVideos().then(() => { window.__ytafD.fetchMs = Math.round(performance.now() - t0); }).catch(() => {});
  window.__r = JSON.stringify({ started: true, insertId });
})();
"ok"
`;

const READ_JS = `
(() => {
  const D = window.__ytafD;
  if (!D || D.error) { window.__r = JSON.stringify(D ?? { error: 'no D' }); return; }
  globalThis.__ytafDebug?.resumePolling();
  window.__r = JSON.stringify({
    insertId: D.insertId, animOn: D.animOn, fetchMs: D.fetchMs, framesSampled: D.frames, done: D.done,
    firstAppearFrame: D.firstAppearFrame, newClassFrame: D.newClassFrame, newImgLoadedFrame: D.newImgLoadedFrame,
    newMinOpacity: +D.newMinOpacity.toFixed(2), newMinScale: +D.newMinScale.toFixed(2), newFinalOpacity: D.newFinalOpacity,
    survivorsGlided: D.survivorsGlided, survivorsTracked: D.survivorsTracked,
    samples: D.samples
  });
})()
`;

const startRes = await evalDirectAsync({
  port: FF_PORT,
  code: START_JS
});
console.log("start:", JSON.stringify(startRes));
await new Promise(resultValue => setTimeout(resultValue, SETTLE_MS));
const result = await evalDirectAsync({
  port: FF_PORT,
  code: READ_JS
});
console.log(JSON.stringify(result, null, 2));

function evalDirectAsync({ port, code }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      port,
      host: "127.0.0.1"
    });
    let rawBuf = Buffer.alloc(0);
    let consoleActor = null,
      phase = "init";
    function send(obj) {
      const j = JSON.stringify(obj);
      const buffer = Buffer.from(j);
      socket.write(`${buffer.byteLength}:${j}`);
    }
    function readPackets() {
      const part = [];
      while (true) {
        const textValue = rawBuf.toString("utf8"),
          char = textValue.indexOf(":");
        if (char === -1) {
          break;
        }

        const len = parseInt(textValue.slice(0, char), 10);
        if (isNaN(len)) {
          rawBuf = Buffer.from(textValue.slice(char + 1));
          continue;
        }

        const body = Buffer.from(textValue.slice(char + 1));
        if (body.byteLength < len) {
          break;
        }

        rawBuf = body.slice(len);
        try {
          part.push(JSON.parse(body.slice(0, len).toString()));
        } catch (_) {}
      }
      return part;
    }
    function values(resultValueValue) {
      if (typeof resultValueValue === "string" && resultValueValue && resultValueValue !== "ok") {
        return resultValueValue;
      }

      if (resultValueValue?.value && typeof resultValueValue.value === "string" && resultValueValue.value !== "ok") {
        return resultValueValue.value;
      }

      return null;
    }
    function finish(raw) {
      socket.destroy();
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    }
    function poll() {
      send({
        to: consoleActor,
        type: "evaluateJSAsync",
        text: "window.__r || ''"
      });
    }
    function handle(pkt) {
      if (pkt.error) {
        socket.destroy();
        reject(new Error(pkt.error));
        return;
      }

      if (phase === "init" && pkt.applicationType) {
        phase = "listing";
        send({
          to: "root",
          type: "listTabs"
        });
        return;
      }

      if (phase === "listing" && pkt.tabs) {
        phase = "targeting";
        const time =
          pkt.tabs.find(timeValue => timeValue.url?.includes("youtube.com/feed/subscriptions")) ?? pkt.tabs[0];
        send({
          to: time.actor,
          type: "getTarget"
        });
        return;
      }

      if (phase === "targeting" && pkt.frame?.consoleActor) {
        phase = "running";
        consoleActor = pkt.frame.consoleActor;
        send({
          to: consoleActor,
          type: "evaluateJSAsync",
          text: `window.__r = undefined; ${code}`
        });
        return;
      }

      if (pkt.type === "evaluationResult") {
        if (phase === "running") {
          phase = "polling";
          setTimeout(poll, POLL_FIRST_MS);
          return;
        }

        if (phase === "polling") {
          const raw = values(pkt.result);
          if (raw) {
            finish(raw);
          } else {
            setTimeout(poll, POLL_RETRY_MS);
          }
        }
      }
    }
    socket.on("data", chunk => {
      rawBuf = Buffer.concat([rawBuf, chunk]);
      for (const partValue of readPackets()) {
        handle(partValue);
      }
    });
    socket.on("error", reject);
    setTimeout(() => {
      socket.destroy();
      reject(new Error("Timeout"));
    }, TIMEOUT_MS);
  });
}
