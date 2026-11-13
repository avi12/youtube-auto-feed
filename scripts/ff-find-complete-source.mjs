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
  const ucIn = text => new Set([...text.matchAll(/"channelId":"(UC[\w-]{22})"/g)].map(m => m[1]));
  const browseUcIn = text => new Set([...text.matchAll(/"browseId":"(UC[\w-]{22})"/g)].map(m => m[1]));

  const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
  const initialData = (await (await fetch("/feed/channels", { credentials: "include" })).text()).match(INITIAL_DATA)?.[1] ?? "";
  const initialUc = ucIn(initialData);

  // (1) every distinct continuation token -> how many NEW UC vs initial
  const tokens = [...new Set([...initialData.matchAll(/"continuationCommand":\{"token":"([^"]+)"/g)].map(m => m[1]))];
  const tokenResults = [];
  for (const token of tokens.slice(0, 6)) {
    const cont = await innertubePost("browse", { continuation: token });
    const text = cont ? JSON.stringify(cont) : "";
    const uc = ucIn(text);
    const newUc = [...uc].filter(id => !initialUc.has(id)).length;
    tokenResults.push({ tokenHead: token.slice(0, 24), totalUc: uc.size, newUc });
  }

  // (2) guide endpoint (sidebar subscriptions)
  const guide = await innertubePost("guide", {});
  const guideText = guide ? JSON.stringify(guide) : "";
  const guideBrowseUc = browseUcIn(guideText);
  const guideHandles = new Set([...guideText.matchAll(/"\/(@[\w.-]+)"/g)].map(m => m[1].toLowerCase()));

  return {
    initialUcCount: initialUc.size,
    distinctTokenCount: tokens.length,
    tokenResults,
    guideOk: !!guide,
    guideDistinctBrowseUc: guideBrowseUc.size,
    guideDistinctHandles: guideHandles.size
  };
})()
