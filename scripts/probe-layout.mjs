/**
 * Probes whether layout positions change synchronously after elGrid.set + Polymer.flush().
 * If positions don't change, the FLIP animation (translate = old - new) produces delta=0 → no glide.
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
  const domData = elItems.map(el => ({
    id: 'data' in el ? videoIdFromDomData(el.data) : null,
    rect: el.getBoundingClientRect()
  }));

  const currentContents = [...elGrid.data.contents];
  const idsBefore = new Set(domData.map(d => d.id).filter(Boolean));

  let targetId = null, removalIndex = -1;
  for (let i = 0; i < currentContents.length; i++) {
    const vid = videoIdFromItem(currentContents[i]);
    if (vid && idsBefore.has(vid)) { targetId = vid; removalIndex = i; break; }
  }
  if (!targetId) { window.__r = JSON.stringify({ error: 'no target' }); return; }

  const newContents = currentContents.filter((_, i) => i !== removalIndex);

  elGrid.set('data.contents', newContents);
  if (globalThis.Polymer?.flush) globalThis.Polymer.flush();

  // Read positions of the same DOM nodes after set+flush
  const afterFlushData = elItems.map(el => ({
    id: 'data' in el ? videoIdFromDomData(el.data) : null,
    rect: el.getBoundingClientRect(),
    inDom: document.contains(el)
  }));

  // Find a survivor (was in DOM before, still in DOM and has same ID)
  const movedSurvivors = [];
  const stuckSurvivors = [];
  for (let i = 0; i < domData.length; i++) {
    const before = domData[i];
    const after = afterFlushData[i];
    if (!before.id || before.id === targetId || !after.inDom) continue;
    const sameSurvivor = before.id === after.id;
    const posChanged = Math.abs(before.rect.top - after.rect.top) >= 1 || Math.abs(before.rect.left - after.rect.left) >= 1;
    if (sameSurvivor) {
      if (posChanged) movedSurvivors.push({ id: before.id, beforeY: +before.rect.top.toFixed(1), afterY: +after.rect.top.toFixed(1) });
      else stuckSurvivors.push({ id: before.id, y: +before.rect.top.toFixed(1) });
    }
  }

  // Restore
  elGrid.set('data.contents', currentContents);

  window.__r = JSON.stringify({
    targetId,
    totalDomBefore: elItems.length,
    movedSurvivors: movedSurvivors.slice(0, 5),
    stuckSurvivors: stuckSurvivors.slice(0, 5),
    movedCount: movedSurvivors.length,
    stuckCount: stuckSurvivors.length,
    layoutUpdatedSynchronously: movedSurvivors.length > 0
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
    function readPkts() {
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
    function xstr(resultValue) {
      if (typeof resultValue === "string" && resultValue && resultValue !== "ok") {
        return resultValue;
      }

      if (resultValue?.value && typeof resultValue.value === "string" && resultValue.value !== "ok") {
        return resultValue.value;
      }

      if (
        resultValue?.displayString &&
        typeof resultValue.displayString === "string" &&
        resultValue.displayString !== "ok"
      ) {
        return resultValue.displayString;
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
          const raw = xstr(pkt.result);
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
      for (const partValue of readPkts()) {
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
