/**
 * Shared Firefox RDP eval helper.
 * Protocol: TCP frames `<byteLength>:<json>`.
 */
import net from "net";

export function evalInFirefox(port, jsCode, { urlFragment = "youtube.com", timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    let rawBuf = Buffer.alloc(0);
    let consoleActor = null;
    let phase = "init";

    function send(obj) {
      const json = JSON.stringify(obj);
      const buf = Buffer.from(json, "utf8");
      socket.write(`${buf.byteLength}:${json}`);
    }

    function sendEval(text) {
      send({ to: consoleActor, type: "evaluateJSAsync", text });
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
        const msgBuf = bodyBuf.slice(0, len);
        rawBuf = bodyBuf.slice(len);
        try { pkts.push(JSON.parse(msgBuf.toString("utf8"))); } catch (_) {}
      }
      return pkts;
    }

    function handle(pkt) {
      if (pkt.error) { socket.destroy(); reject(new Error(`RDP error: ${pkt.error} - ${pkt.message}`)); return; }
      if (phase === "init" && pkt.applicationType) {
        phase = "listing";
        send({ to: "root", type: "listTabs" });
        return;
      }
      if (phase === "listing" && pkt.tabs) {
        phase = "targeting";
        const tab = pkt.tabs.find(t => t.url?.includes(urlFragment)) ?? pkt.tabs[0];
        send({ to: tab.actor, type: "getTarget" });
        return;
      }
      if (phase === "targeting" && pkt.frame?.consoleActor) {
        phase = "running";
        consoleActor = pkt.frame.consoleActor;
        const wrapped = `window.__r = undefined; (async () => { try { window.__r = JSON.stringify(${jsCode}); } catch(e) { window.__r = JSON.stringify({error: String(e)}); } })(); "ok"`;
        sendEval(wrapped);
        return;
      }
      if (pkt.type === "evaluationResult") {
        if (phase === "running") { phase = "polling"; pollForResult(); return; }
        if (phase === "polling") {
          const raw = extractStringResult(pkt.result);
          if (raw) {
            socket.destroy();
            try { resolve(JSON.parse(raw)); } catch (_) { resolve(raw); }
          } else {
            setTimeout(pollForResult, 150);
          }
        }
      }
    }

    function pollForResult() {
      sendEval("window.__r || ''");
    }

    function extractStringResult(result) {
      if (typeof result === "string" && result !== "" && result !== "ok") return result;
      if (result && typeof result === "object") {
        const v = result.value ?? result.displayString ?? "";
        if (typeof v === "string" && v !== "" && v !== "ok") return v;
      }
      return null;
    }

    socket.on("data", chunk => {
      rawBuf = Buffer.concat([rawBuf, chunk]);
      for (const pkt of readPackets()) handle(pkt);
    });
    socket.on("error", reject);
    setTimeout(() => { socket.destroy(); reject(new Error("Timeout")); }, timeoutMs);
  });
}
