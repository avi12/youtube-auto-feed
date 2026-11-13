/**
 * Slow-mo replay of the production survivor FLIP on a front-insert, so the glide can be screenshotted
 * mid-flight. Reduces the grid, settles, records oldRects, then re-inserts and pins+releases survivors
 * exactly like production (same 600px cap) but over SLOW_MS. Kicks off async and returns immediately.
 */
import net from "net";

const FF_PORT = parseInt(process.argv[2] ?? "56517", 10);
const SLOW_MS = parseInt(process.argv[3] ?? "2600", 10);

const probeJs = `
(async () => {
  const elGrid = document.querySelector('ytd-rich-grid-renderer');
  if (!elGrid?.data?.contents?.length) { window.__r = JSON.stringify({ error: 'no grid' }); return; }
  globalThis.__ytafDebug?.pausePolling();
  const SEL = 'ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer';
  const CAP = 600, SLOW = ${SLOW_MS};
  function vidFromData(d) {
    return d?.content?.videoRenderer?.videoId ?? d?.content?.lockupViewModel?.contentId
      ?? d?.content?.lockupViewModel?.videoId
      ?? d?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  }
  function vidFromItem(item) {
    return item?.richItemRenderer?.content?.videoRenderer?.videoId ?? item?.richItemRenderer?.content?.lockupViewModel?.contentId
      ?? item?.richItemRenderer?.content?.lockupViewModel?.videoId
      ?? item?.richItemRenderer?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ?? null;
  }
  const raf = () => new Promise(r => requestAnimationFrame(() => r()));
  const inReflow = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight + 1200; };

  const fullContents = [...elGrid.data.contents];
  let insertIndex = -1, insertId = null;
  for (let i = 0; i < fullContents.length; i++) { const v = vidFromItem(fullContents[i]); if (v) { insertIndex = i; insertId = v; break; } }
  if (!insertId) { window.__r = JSON.stringify({ error: 'no inline video' }); return; }
  const reducedContents = fullContents.filter((_, i) => i !== insertIndex);

  elGrid.set('data.contents', reducedContents);
  if (globalThis.Polymer?.flush) globalThis.Polymer.flush();
  await raf(); await raf();

  const oldRects = new Map();
  for (const el of document.querySelectorAll(SEL)) { if (!inReflow(el) || !('data' in el)) continue; const id = vidFromData(el.data); if (id) oldRects.set(id, el.getBoundingClientRect()); }

  window.__r = JSON.stringify({ kickoff: true, insertId, tracked: oldRects.size });

  // rAF: set full, flush, pin survivors (production cap logic), hide new tile.
  await new Promise(resolve => requestAnimationFrame(() => {
    elGrid.set('data.contents', fullContents);
    if (globalThis.Polymer?.flush) globalThis.Polymer.flush();
    for (const el of document.querySelectorAll(SEL)) {
      if (!inReflow(el) || !('data' in el)) continue;
      const id = vidFromData(el.data);
      if (!id || id === insertId || !oldRects.has(id)) continue;
      const o = oldRects.get(id);
      el.style.transition = 'none'; el.style.translate = '';
      const n = el.getBoundingClientRect();
      const dx = o.left - n.left, dy = o.top - n.top;
      const moved = Math.abs(dx) >= 1 || Math.abs(dy) >= 1;
      if (moved) el.style.translate = dx + 'px ' + dy + 'px';
    }
    resolve();
  }));

  // Release on next frame, slow: every moved survivor slides to its new slot (Google-Meet reflow).
  await raf();
  let glideCount = 0;
  for (const el of document.querySelectorAll(SEL)) {
    if (!el.style.translate) { el.style.transition = ''; continue; }
    el.style.transition = 'translate ' + SLOW + 'ms cubic-bezier(0.4, 0, 0.2, 1)';
    el.style.translate = '';
    glideCount++;
  }
  window.__r2 = JSON.stringify({ glideCount });
})();
"ok"
`;

const result = await evalDirectAsync(FF_PORT, probeJs);
console.log("kickoff:", JSON.stringify(result));

function evalDirectAsync(port, code) {
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
          setTimeout(poll, 200);
          return;
        }

        if (phase === "polling") {
          const raw = values(pkt.result);
          if (raw) {
            socket.destroy();
            try {
              resolve(JSON.parse(raw));
            } catch (_) {
              resolve(raw);
            }
          } else {
            setTimeout(poll, 100);
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
    }, 40000);
  });
}
