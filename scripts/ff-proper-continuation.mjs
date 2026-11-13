await (async () => {
  const YOUTUBE_ORIGIN = "https://www.youtube.com";
  async function sapisidHashHeader() {
    const s = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)?.[1];
    if (!s) return null;
    const t = Math.floor(Date.now() / 1000);
    const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${t} ${s} ${YOUTUBE_ORIGIN}`));
    return `SAPISIDHASH ${t}_${[...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("")}`;
  }
  async function innertubePost(payload) {
    const k = ytcfg?.get("INNERTUBE_API_KEY");
    const c = ytcfg?.get("INNERTUBE_CONTEXT");
    const a = await sapisidHashHeader();
    const h = { "Content-Type": "application/json", "X-Youtube-Client-Name": "1", "X-Youtube-Client-Version": c.client.clientVersion };
    if (a) { h.Authorization = a; h["X-Origin"] = YOUTUBE_ORIGIN; }
    const r = await fetch(`/youtubei/v1/browse?key=${k}&prettyPrint=false`, { method: "POST", credentials: "include", headers: h, body: JSON.stringify({ context: c, ...payload }) }).catch(() => null);
    return r?.ok ? r.json().catch(() => null) : null;
  }

  // find tokens that sit inside a continuationItemRenderer (the real "load more" tokens)
  function findContinuationItemTokens(node, acc) {
    if (!node || typeof node !== "object") return acc;
    if (node.continuationItemRenderer) {
      const tok = node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (tok) acc.push(tok);
    }
    for (const k in node) findContinuationItemTokens(node[k], acc);
    return acc;
  }
  function ucIn(obj) { return new Set([...JSON.stringify(obj).matchAll(/"channelId":"(UC[\w-]{22})"/g)].map(m => m[1])); }

  const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
  const raw = await (await fetch("/feed/channels", { credentials: "include" })).text();
  let initial;
  try { initial = JSON.parse(raw.match(INITIAL_DATA)?.[1] ?? "{}"); } catch (e) { return { error: "parse fail: " + e }; }

  const all = new Set([...ucIn(initial)]);
  const startCount = all.size;
  const itemTokens = findContinuationItemTokens(initial, []);
  const pages = [];
  let token = itemTokens[0];
  const seenTokens = new Set();
  for (let p = 0; token && !seenTokens.has(token) && p < 8; p++) {
    seenTokens.add(token);
    const resp = await innertubePost({ continuation: token });
    if (!resp) { pages.push({ page: p, result: "null" }); break; }
    const before = all.size;
    for (const id of ucIn(resp)) all.add(id);
    const nextTokens = findContinuationItemTokens(resp, []);
    pages.push({ page: p, tokenHead: token.slice(0, 20), newUc: all.size - before, total: all.size, nextTokenHead: nextTokens[0]?.slice(0, 20) ?? null });
    token = nextTokens[0];
  }

  return {
    initialUc: startCount,
    continuationItemTokenCount: itemTokens.length,
    continuationItemTokenHeads: itemTokens.map(t => t.slice(0, 20)),
    finalTotalUc: all.size,
    pages
  };
})()
