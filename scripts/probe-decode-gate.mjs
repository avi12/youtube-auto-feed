/**
 * Validates the decode-gate mechanism (awaitNewThumbnailsReady): a COLD thumbnail URL must make the
 * gate wait frames until it decodes; a CACHED URL must pass ~instantly. Mirrors the production logic.
 */
import net from "net";

const FF_PORT = parseInt(process.argv[2] ?? "56517", 10);
const POLL_FIRST_MS = 200;
const POLL_RETRY_MS = 150;
const TIMEOUT_MS = 30000;

const PROBE_JS = `
(async () => {
  const img0 = document.querySelector('ytd-rich-grid-renderer img[src*="i.ytimg.com"], ytd-rich-grid-renderer img[src*="ggpht"], ytd-rich-grid-renderer img');
  const baseUrl = [...document.querySelectorAll('ytd-rich-grid-renderer img')].map(i => i.src).find(s => s && s.includes('ytimg.com'));
  if (!baseUrl) { window.__r = JSON.stringify({ error: 'no thumbnail url found' }); return; }

  const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
  const CAP = 180;

  async function gate(urls) {
    let ready = false, frames = 0;
    Promise.all(urls.map(u => { const img = new Image(); img.src = u; return img.decode().catch(() => {}); })).then(() => { ready = true; });
    for (; frames < CAP && !ready; frames++) await nextFrame();
    return frames;
  }

  // Cold: cache-bust the real thumbnail so the browser must fetch it.
  const coldUrl = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'ytafcold=' + Math.floor(performance.now()) + Math.random().toString(36).slice(2);
  const coldFrames = await gate([coldUrl]);
  // Confirm the cold image is now decoded/cached.
  const probeImg = new Image(); probeImg.src = coldUrl;
  await probeImg.decode().catch(() => {});
  const coldDecoded = probeImg.naturalWidth > 0;

  // Cached: the same URL we just warmed should now pass instantly.
  const cachedFrames = await gate([coldUrl]);

  // Also: a URL already in the live feed (warm) should pass instantly.
  const warmFrames = await gate([baseUrl]);

  window.__r = JSON.stringify({
    coldFramesWaited: coldFrames, coldDecoded,
    cachedFramesWaited: cachedFrames, warmFramesWaited: warmFrames,
    interpretation: coldFrames > cachedFrames && coldDecoded ? 'GATE WORKS: cold waits + decodes, cached instant' : 'CHECK'
  });
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
