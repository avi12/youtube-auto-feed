/**
 * Accurate settle probe: picks a target that IS in both DOM and currentContents.
 */
import net from "net";

const PORT = parseInt(process.argv[2] ?? "56517", 10);

const probeJs = `
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
  function inlineDomIds() {
    return new Set([...document.querySelectorAll('ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer')]
      .map(el => ('data' in el ? videoIdFromDomData(el.data) : null)).filter(Boolean));
  }

  const currentContents = [...elGrid.data.contents];
  const idsBefore = inlineDomIds();

  let targetId = null, removalIndex = -1;
  for (let i = 0; i < currentContents.length; i++) {
    const vid = videoIdFromItem(currentContents[i]);
    if (vid && idsBefore.has(vid)) { targetId = vid; removalIndex = i; break; }
  }
  if (!targetId) { window.__r = JSON.stringify({ error: 'no matching target', domCount: idsBefore.size }); return; }

  const newContents = currentContents.filter((_, i) => i !== removalIndex);
  const expectedIds = new Set(newContents.map(videoIdFromItem).filter(Boolean));

  const t0 = performance.now();
  elGrid.set('data.contents', newContents);
  const setMs = +(performance.now() - t0).toFixed(1);
  if (globalThis.Polymer?.flush) globalThis.Polymer.flush();
  const flushMs = +(performance.now() - t0).toFixed(1);

  const afterFlushIds = inlineDomIds();
  const removedGone = !afterFlushIds.has(targetId);
  const countMatch = afterFlushIds.size === expectedIds.size;

  const MAX = 20;
  const frames = [];
  let settledAt = (removedGone && countMatch) ? 0 : -1;

  if (settledAt === -1) {
    await new Promise(r => {
      function tick() {
        const ids = inlineDomIds();
        const gone = !ids.has(targetId);
        const match = gone && ids.size === expectedIds.size;
        frames.push({ f: frames.length + 1, n: ids.size, gone, match });
        if (match) { settledAt = frames.length; r(); return; }
        if (frames.length < MAX) requestAnimationFrame(tick); else r();
      }
      requestAnimationFrame(tick);
    });
  }

  elGrid.set('data.contents', currentContents);

  window.__r = JSON.stringify({
    targetId, domBefore: idsBefore.size, expectedCount: expectedIds.size,
    setMs, flushMs,
    removedGoneAfterFlush: removedGone, afterFlushCount: afterFlushIds.size,
    settledAt, frames
  });
})();
"ok"
`;

const result = await evalDirectAsync(PORT, probeJs);
console.log(JSON.stringify(result, null, 2));

function evalDirectAsync(port, code) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    let rawBuf = Buffer.alloc(0);
    let consoleActor = null, phase = "init";

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
        if (colon === -1) break;
        const len = parseInt(str.slice(0, colon), 10);
        if (isNaN(len)) { rawBuf = Buffer.from(str.slice(colon + 1), "utf8"); continue; }
        const bodyBuf = Buffer.from(str.slice(colon + 1), "utf8");
        if (bodyBuf.byteLength < len) break;
        rawBuf = bodyBuf.slice(len);
        try { pkts.push(JSON.parse(bodyBuf.slice(0, len).toString("utf8"))); } catch (_) {}
      }
      return pkts;
    }
    function extractString(r) {
      if (typeof r === "string" && r && r !== "ok") return r;
      if (r && typeof r === "object") { const v = r.value ?? r.displayString ?? ""; if (typeof v === "string" && v && v !== "ok") return v; }
      return null;
    }
    function poll() { send({ to: consoleActor, type: "evaluateJSAsync", text: "window.__r || ''" }); }
    function handle(pkt) {
      if (pkt.error) { socket.destroy(); reject(new Error(pkt.error)); return; }
      if (phase === "init" && pkt.applicationType) { phase = "listing"; send({ to: "root", type: "listTabs" }); return; }
      if (phase === "listing" && pkt.tabs) {
        phase = "targeting";
        const tab = pkt.tabs.find(t => t.url?.includes("youtube.com/feed/subscriptions")) ?? pkt.tabs[0];
        send({ to: tab.actor, type: "getTarget" }); return;
      }
      if (phase === "targeting" && pkt.frame?.consoleActor) {
        phase = "running"; consoleActor = pkt.frame.consoleActor;
        send({ to: consoleActor, type: "evaluateJSAsync", text: `window.__r = undefined; ${code}` }); return;
      }
      if (pkt.type === "evaluationResult") {
        if (phase === "running") { phase = "polling"; setTimeout(poll, 300); return; }
        if (phase === "polling") {
          const raw = extractString(pkt.result);
          if (raw) { socket.destroy(); try { resolve(JSON.parse(raw)); } catch (_) { resolve(raw); } }
          else setTimeout(poll, 200);
        }
      }
    }
    socket.on("data", chunk => { rawBuf = Buffer.concat([rawBuf, chunk]); for (const pkt of readPackets()) handle(pkt); });
    socket.on("error", reject);
    setTimeout(() => { socket.destroy(); reject(new Error("Timeout")); }, 40000);
  });
}
