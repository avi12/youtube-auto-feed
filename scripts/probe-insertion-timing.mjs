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
const POLL_FIRST_MS = 300;
const POLL_RETRY_MS = 200;
const TIMEOUT_MS = 40000;

const PROBE_JS = `
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

const result = await evalDirectAsync({
  port: FF_PORT,
  code: PROBE_JS
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
    function values(resultValue) {
      if (typeof resultValue === "string" && resultValue && resultValue !== "ok") {
        return resultValue;
      }

      if (resultValue?.value && typeof resultValue.value === "string" && resultValue.value !== "ok") {
        return resultValue.value;
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
