await (async () => {
  const YOUTUBE_ORIGIN = "https://www.youtube.com";
  async function sapisidHashHeader() {
    const s = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)?.[1];
    if (!s) return null;
    const t = Math.floor(Date.now() / 1000);
    const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${t} ${s} ${YOUTUBE_ORIGIN}`));
    return `SAPISIDHASH ${t}_${[...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("")}`;
  }
  const auth = await sapisidHashHeader();
  const key = ytcfg.get("INNERTUBE_API_KEY");
  const baseContext = ytcfg.get("INNERTUBE_CONTEXT");
  async function browseFEchannels(clientOverride) {
    const context = { ...baseContext, client: { ...baseContext.client, ...clientOverride } };
    const h = { "Content-Type": "application/json", "X-Youtube-Client-Name": "1", "X-Youtube-Client-Version": baseContext.client.clientVersion };
    if (auth) { h.Authorization = auth; h["X-Origin"] = YOUTUBE_ORIGIN; }
    const r = await fetch(`/youtubei/v1/browse?key=${key}&prettyPrint=false`, { method: "POST", credentials: "include", headers: h, body: JSON.stringify({ context, browseId: "FEchannels" }) }).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    if (!j) return { uc: 0, hasCont: false };
    const uc = new Set([...JSON.stringify(j).matchAll(/"channelId":"(UC[\w-]{22})"/g)].map(m => m[1])).size;
    const hasCont = JSON.stringify(j).includes("continuationItemRenderer");
    return { uc, hasCont };
  }

  return {
    baseline: await browseFEchannels({}),
    windowWidth2000: await browseFEchannels({ windowWidthPoints: 2000 }),
    screenPoints: await browseFEchannels({ screenWidthPoints: 2000, screenHeightPoints: 6000, screenPixelDensity: 1, screenDensityFloat: 1 }),
    combined: await browseFEchannels({ windowWidthPoints: 2000, screenWidthPoints: 2000, screenHeightPoints: 6000, screenPixelDensity: 1, screenDensityFloat: 1, memoryTotalKbytes: "8000000" })
  };
})()
