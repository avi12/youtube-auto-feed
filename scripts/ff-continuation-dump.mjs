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
  const CONTINUATION = /"continuationCommand":\{"token":"([^"]+)"/;
  const initialData = (await (await fetch("/feed/channels", { credentials: "include" })).text()).match(INITIAL_DATA)?.[1] ?? "";
  const token = initialData.match(CONTINUATION)?.[1];
  if (!token) return { error: "no token in initial" };

  const cont = await innertubePost("browse", { continuation: token });
  if (!cont) return { error: "null continuation response", tokenHead: token.slice(0, 30) };
  const text = JSON.stringify(cont);

  return {
    tokenHead: token.slice(0, 40),
    topLevelKeys: Object.keys(cont),
    responseLength: text.length,
    occ_channelRenderer: (text.match(/"channelRenderer"/g) ?? []).length,
    occ_channelId_UC: (text.match(/"channelId":"UC[\w-]{22}"/g) ?? []).length,
    occ_strictRegex: (text.match(/"channelRenderer":\{"channelId":"UC[\w-]{22}"/g) ?? []).length,
    occ_canonicalHandle: (text.match(/"canonicalBaseUrl":"\/@[\w.-]+"/g) ?? []).length,
    occ_continuationItems: (text.match(/"continuationItems"/g) ?? []).length,
    occ_appendAction: (text.match(/"appendContinuationItemsAction"/g) ?? []).length,
    sampleAroundChannelRenderer: text.includes('"channelRenderer"') ? text.slice(text.indexOf('"channelRenderer"'), text.indexOf('"channelRenderer"') + 260) : null,
    head: text.slice(0, 400)
  };
})()
