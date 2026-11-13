/**
 * Measures how many rAF frames Polymer takes to settle after a grid.set removal on Firefox.
 * Usage: node scripts/firefox-settle-probe.mjs <port>
 */

const PORT = parseInt(process.argv[2] ?? "56517", 10);

// The probe sets window.__r directly (can't return async values through the wrapper)
const probeCode = `
(async () => {
  const elGrid = document.querySelector('ytd-rich-grid-renderer');
  if (!elGrid?.data?.contents?.length) { window.__r = JSON.stringify({ error: 'no grid' }); return; }

  function videoIdFromItem(item) {
    return item?.richItemRenderer?.content?.videoRenderer?.videoId
      ?? item?.richItemRenderer?.content?.lockupViewModel?.contentId
      ?? item?.richItemRenderer?.content?.lockupViewModel?.videoId
      ?? item?.richItemRenderer?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
      ?? null;
  }

  function videoIdFromDomData(data) {
    // el.data is the item's inner data (no richItemRenderer wrapper): {content: {...}}
    return data?.content?.videoRenderer?.videoId
      ?? data?.content?.lockupViewModel?.contentId
      ?? data?.content?.lockupViewModel?.videoId
      ?? data?.content?.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
      ?? null;
  }

  function inlineDomIds() {
    return [...document.querySelectorAll('ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer')]
      .map(el => ('data' in el ? videoIdFromDomData(el.data) : null))
      .filter(Boolean).join(',');
  }

  const currentContents = [...elGrid.data.contents];
  const firstInlineIndex = currentContents.findIndex(item => videoIdFromItem(item));
  if (firstInlineIndex === -1) { window.__r = JSON.stringify({ error: 'no inline items' }); return; }

  const removedId = videoIdFromItem(currentContents[firstInlineIndex]);
  const newContents = currentContents.filter((_, i) => i !== firstInlineIndex);
  const expectedIds = newContents.map(videoIdFromItem).filter(Boolean).join(',');
  const beforeCount = inlineDomIds().split(',').filter(Boolean).length;

  const t0 = performance.now();
  elGrid.set('data.contents', newContents);
  const afterSetMs = performance.now() - t0;

  if (globalThis.Polymer?.flush) globalThis.Polymer.flush();
  const afterFlushMs = performance.now() - t0;

  const afterFlushIds = inlineDomIds();
  const afterFlushCount = afterFlushIds.split(',').filter(Boolean).length;
  const settledAfterFlush = afterFlushIds === expectedIds;

  let frames = 0;
  let settledAt = settledAfterFlush ? 0 : -1;
  const frameTimes = [];
  const MAX_FRAMES = 30;

  if (!settledAfterFlush) {
    await new Promise(resolve => {
      function tick() {
        frames++;
        const domIds = inlineDomIds();
        const matches = domIds === expectedIds;
        frameTimes.push({ frame: frames, matches, count: domIds.split(',').filter(Boolean).length });
        if (matches) { settledAt = frames; resolve(); return; }
        if (frames < MAX_FRAMES) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
  }

  // Restore
  elGrid.set('data.contents', currentContents);

  window.__r = JSON.stringify({
    removedId,
    beforeCount,
    expectedCount: newContents.map(videoIdFromItem).filter(Boolean).length,
    afterSetMs: +afterSetMs.toFixed(2),
    afterFlushMs: +afterFlushMs.toFixed(2),
    settledAfterFlush,
    afterFlushCount,
    settledAt,
    frameTimes
  });
})();
"probe-started"
`;

// Use the low-level evalInFirefox but override the wrapper to NOT double-wrap
import net from "net";

const result = await evalDirectAsync(PORT, probeCode);
console.log(JSON.stringify(result, null, 2));

function evalDirectAsync(port, code) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      port,
      host: "127.0.0.1"
    });
    let rawBuf = Buffer.alloc(0);
    let consoleActor = null;
    let phase = "init";

    function send(obj) {
      const json = JSON.stringify(obj);
      const buf = Buffer.from(json, "utf8");
      socket.write(`${buf.byteLength}:${json}`);
    }

    function readPackets() {
      const pkts = [];
      while (true) {
        const str = rawBuf.toString("utf8");
        const colon = str.indexOf(":");
        if (colon === -1) {
          break;
        }

        const len = parseInt(str.slice(0, colon), 10);
        if (isNaN(len)) {
          rawBuf = Buffer.from(str.slice(colon + 1), "utf8");
          continue;
        }

        const bodyBuf = Buffer.from(str.slice(colon + 1), "utf8");
        if (bodyBuf.byteLength < len) {
          break;
        }

        rawBuf = bodyBuf.slice(len);
        try {
          pkts.push(JSON.parse(bodyBuf.slice(0, len).toString("utf8")));
        } catch (_) {}
      }
      return pkts;
    }

    function extractString(result) {
      if (typeof result === "string" && result !== "" && result !== "probe-started") {
        return result;
      }

      if (result && typeof result === "object") {
        const valueValue = result.value ?? result.displayString ?? "";
        if (typeof valueValue === "string" && valueValue !== "" && valueValue !== "probe-started") {
          return valueValue;
        }
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
        reject(new Error(`RDP: ${pkt.error}`));
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
        const tab = pkt.tabs.find(time => time.url?.includes("youtube.com/feed/subscriptions")) ?? pkt.tabs[0];
        send({
          to: tab.actor,
          type: "getTarget"
        });
        return;
      }

      if (phase === "targeting" && pkt.frame?.consoleActor) {
        phase = "running";
        consoleActor = pkt.frame.consoleActor;
        // Send probe code directly - it sets window.__r internally
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
          const raw = extractString(pkt.result);
          if (raw) {
            socket.destroy();
            try {
              resolve(JSON.parse(raw));
            } catch (_) {
              resolve(raw);
            }
          } else {
            setTimeout(poll, 200);
          }
        }
      }
    }

    socket.on("data", chunk => {
      rawBuf = Buffer.concat([rawBuf, chunk]);
      for (const pkt of readPackets()) {
        handle(pkt);
      }
    });
    socket.on("error", reject);
    setTimeout(() => {
      socket.destroy();
      reject(new Error("Timeout"));
    }, 35000);
  });
}
