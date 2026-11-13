/**
 * Triggers a REAL extension insertion on Firefox: force animations on (in MAIN memory), pause polling,
 * drop the front Latest video, then fetchFreshVideos() so the mirror re-inserts via setContentsWithFlip.
 * Returns immediately so the caller can screenshot the (slowed) animation.
 */
import net from "net";

const FF_PORT = parseInt(process.argv[2] ?? "56517", 10);
const POLL_FIRST_MS = 150;
const POLL_RETRY_MS = 100;
const TIMEOUT_MS = 30000;

const PROBE_JS = `
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

const result = await evalDirectAsync({
  port: FF_PORT,
  code: PROBE_JS
});
console.log(JSON.stringify(result));

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
