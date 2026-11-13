/**
 * Trigger a simulated removal on Firefox and take a screenshot mid-animation.
 * Does NOT restore - leaves the grid in the post-removal state for screenshot.
 */
import net from "net";

const FF_PORT = parseInt(process.argv[2] ?? "56517", 10);
const POLL_FIRST_MS = 300;
const POLL_RETRY_MS = 200;
const TIMEOUT_MS = 40000;
const SETTLE_MS = 100;

// Trigger removal (does not restore - leaves grid in new state)
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
  const currentContents = [...elGrid.data.contents];
  const idsBefore = new Map(elItems.map(el => [('data' in el ? videoIdFromDomData(el.data) : null), el]).filter(([id]) => id));

  let targetId = null, removalIndex = -1;
  for (let i = 0; i < currentContents.length; i++) {
    const vid = videoIdFromItem(currentContents[i]);
    if (vid && idsBefore.has(vid)) { targetId = vid; removalIndex = i; break; }
  }
  if (!targetId) { window.__r = JSON.stringify({ error: 'no target' }); return; }

  const newContents = currentContents.filter((_, i) => i !== removalIndex);

  // Record old rects
  const oldRects = {};
  for (const [id, el] of idsBefore) {
    const r = el.getBoundingClientRect();
    oldRects[id] = { top: r.top, left: r.left };
  }

  // Do set+flush
  elGrid.set('data.contents', newContents);
  if (globalThis.Polymer?.flush) globalThis.Polymer.flush();

  // Pin survivors at old positions (FLIP setup)
  for (const el of document.querySelectorAll('ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer')) {
    if (!('data' in el)) continue;
    const id = videoIdFromDomData(el.data);
    if (!id || id === targetId || !oldRects[id]) continue;
    const old = oldRects[id];
    el.style.transition = 'none';
    el.style.translate = '';
    const newR = el.getBoundingClientRect();
    const dx = old.left - newR.left, dy = old.top - newR.top;
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) el.style.translate = dx + 'px ' + dy + 'px';
  }

  // Release (glide to new positions)
  await new Promise(r => requestAnimationFrame(r));
  for (const el of document.querySelectorAll('ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer')) {
    if (!el.style.translate) { el.style.transition = ''; continue; }
    el.style.transition = 'translate 380ms cubic-bezier(0.4, 0, 0.2, 1)';
    el.style.translate = '';
    el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
  }

  window.__r = JSON.stringify({ done: true, targetId, removedAt: removalIndex });
})();
"ok"
`;

console.log("Triggering removal on Firefox...");
const result = await evalDirectAsync({
  port: FF_PORT,
  code: PROBE_JS
});
console.log("Trigger result:", JSON.stringify(result));

// Small delay to let the animation start, then screenshot
await new Promise(resultValue => setTimeout(resultValue, SETTLE_MS));

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
