await (async () => {
  const YOUTUBE_ORIGIN = "https://www.youtube.com";
  async function sapisidHashHeader() {
    const s = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)?.[1];
    if (!s) return null;
    const t = Math.floor(Date.now() / 1000);
    const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${t} ${s} ${YOUTUBE_ORIGIN}`));
    return `SAPISIDHASH ${t}_${[...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("")}`;
  }
  async function innertubePost(endpoint, payload) {
    const k = ytcfg?.get("INNERTUBE_API_KEY");
    const c = ytcfg?.get("INNERTUBE_CONTEXT");
    if (!k || !c) return null;
    const a = await sapisidHashHeader();
    const h = { "Content-Type": "application/json", "X-Youtube-Client-Name": "1", "X-Youtube-Client-Version": c.client.clientVersion };
    if (a) { h.Authorization = a; h["X-Origin"] = YOUTUBE_ORIGIN; }
    const r = await fetch(`/youtubei/v1/${endpoint}?key=${k}&prettyPrint=false`, { method: "POST", credentials: "include", headers: h, body: JSON.stringify({ context: c, ...payload }) }).catch(() => null);
    return r?.ok ? r.json().catch(() => null) : null;
  }

  const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
  const CHANNEL_ID = /"channelRenderer":\{"channelId":"(UC[\w-]{22})"/g;
  const HANDLE = /"canonicalBaseUrl":"\/(@[\w.-]+)"/g;
  const CONTINUATION = /"continuationCommand":\{"token":"([^"]+)"/;
  const PAGE_CAP = 8;

  function readKeys(text, into) {
    for (const m of text.matchAll(CHANNEL_ID)) into.add(m[1]);
    for (const m of text.matchAll(HANDLE)) into.add(m[1].toLowerCase());
    return into.size;
  }

  const initialData = (await (await fetch("/feed/channels", { credentials: "include" })).text()).match(INITIAL_DATA)?.[1] ?? "";
  const keys = new Set();
  readKeys(initialData, keys);
  const initialCount = keys.size;

  const pageSizes = [];
  let token = initialData.match(CONTINUATION)?.[1];
  for (let page = 0; token && page < PAGE_CAP; page++) {
    const continuation = await innertubePost("browse", { continuation: token });
    if (!continuation) { pageSizes.push("null-response"); break; }
    const before = keys.size;
    const text = JSON.stringify(continuation);
    readKeys(text, keys);
    pageSizes.push(keys.size - before);
    const next = text.match(CONTINUATION)?.[1];
    token = next && next !== token && keys.size > before ? next : undefined;
  }

  const ucCount = [...keys].filter(k => k.startsWith("UC")).length;
  const handleCount = [...keys].filter(k => k.startsWith("@")).length;
  return { initialKeyCount: initialCount, finalKeyCount: keys.size, ucCount, handleCount, pagesFollowed: pageSizes.length, channelsAddedPerPage: pageSizes };
})()
