await (async () => {
  const YOUTUBE_ORIGIN = "https://www.youtube.com";
  async function sapisidHashHeader() {
    const s = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)?.[1];
    if (!s) return null;
    const t = Math.floor(Date.now() / 1000);
    const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${t} ${s} ${YOUTUBE_ORIGIN}`));
    return `SAPISIDHASH ${t}_${[...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("")}`;
  }
  async function browse(payload) {
    const k = ytcfg?.get("INNERTUBE_API_KEY");
    const c = ytcfg?.get("INNERTUBE_CONTEXT");
    const a = await sapisidHashHeader();
    const h = { "Content-Type": "application/json", "X-Youtube-Client-Name": "1", "X-Youtube-Client-Version": c.client.clientVersion };
    if (a) { h.Authorization = a; h["X-Origin"] = YOUTUBE_ORIGIN; }
    const r = await fetch(`/youtubei/v1/browse?key=${k}&prettyPrint=false`, { method: "POST", credentials: "include", headers: h, body: JSON.stringify({ context: c, ...payload }) }).catch(() => null);
    return r?.ok ? r.json().catch(() => null) : null;
  }
  function findContinuationTokens(node, acc) {
    if (!node || typeof node !== "object") return acc;
    if (node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) acc.push(node.continuationItemRenderer.continuationEndpoint.continuationCommand.token);
    for (const k in node) findContinuationTokens(node[k], acc);
    return acc;
  }
  const ucIn = obj => new Set([...JSON.stringify(obj).matchAll(/"channelId":"(UC[\w-]{22})"/g)].map(m => m[1]));

  const first = await browse({ browseId: "FEchannels" });
  if (!first) return { error: "FEchannels browse null" };
  const all = new Set([...ucIn(first)]);
  const firstCount = all.size;
  const firstHasContinuationItem = findContinuationTokens(first, []).length;

  const pages = [];
  let token = findContinuationTokens(first, [])[0];
  const seen = new Set();
  for (let p = 0; token && !seen.has(token) && p < 8; p++) {
    seen.add(token);
    const resp = await browse({ continuation: token });
    if (!resp) { pages.push({ page: p, result: "null" }); break; }
    const before = all.size;
    for (const id of ucIn(resp)) all.add(id);
    const next = findContinuationTokens(resp, [])[0];
    pages.push({ page: p, newUc: all.size - before, total: all.size, hasNext: !!next });
    token = next;
  }

  return { firstResponseUc: firstCount, firstHasContinuationItem, finalTotalUc: all.size, pageCount: pages.length, pages };
})()
