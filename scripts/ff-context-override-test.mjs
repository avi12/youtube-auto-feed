await (async () => {
  const HEX_RADIX = 16;
  const WIDE_POINTS = 2000;
  const TALL_POINTS = 6000;
  const YOUTUBE_ORIGIN = "https://www.youtube.com";
  async function sapisidHashHeader() {
    const text = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)?.[1];
    if (!text) {
      return null;
    }

    const time = Math.floor(Date.now() / 1000);
    const data = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${time} ${text} ${YOUTUBE_ORIGIN}`));
    return `SAPISIDHASH ${time}_${[...new Uint8Array(data)].map(buffer => buffer.toString(HEX_RADIX).padStart(2, "0")).join("")}`;
  }
  const auth = await sapisidHashHeader();
  const key = ytcfg.get("INNERTUBE_API_KEY");
  const baseContext = ytcfg.get("INNERTUBE_CONTEXT");
  async function browseFEchannels(clientOverride) {
    const context = {
      ...baseContext,
      client: {
        ...baseContext.client,
        ...clientOverride
      }
    };
    const handler = {
      "Content-Type": "application/json",
      "X-Youtube-Client-Name": "1",
      "X-Youtube-Client-Version": baseContext.client.clientVersion
    };
    if (auth) {
      handler.Authorization = auth;
      handler["X-Origin"] = YOUTUBE_ORIGIN;
    }

    const result = await fetch(`/youtubei/v1/browse?key=${key}&prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      headers: handler,
      body: JSON.stringify({
        context,
        browseId: "FEchannels"
      })
    }).catch(() => null);
    const j = result?.ok ? await result.json().catch(() => null) : null;
    if (!j) {
      return {
        uc: 0,
        hasCont: false
      };
    }

    const contextValue = new Set(
      [...JSON.stringify(j).matchAll(/"channelId":"(UC[\w-]{22})"/g)].map(message => message[1])
    ).size;
    const hasCont = JSON.stringify(j).includes("continuationItemRenderer");
    return {
      uc: contextValue,
      hasCont
    };
  }

  return {
    baseline: await browseFEchannels({}),
    windowWidth2000: await browseFEchannels({ windowWidthPoints: WIDE_POINTS }),
    screenPoints: await browseFEchannels({
      screenWidthPoints: WIDE_POINTS,
      screenHeightPoints: TALL_POINTS,
      screenPixelDensity: 1,
      screenDensityFloat: 1
    }),
    combined: await browseFEchannels({
      windowWidthPoints: WIDE_POINTS,
      screenWidthPoints: WIDE_POINTS,
      screenHeightPoints: TALL_POINTS,
      screenPixelDensity: 1,
      screenDensityFloat: 1,
      memoryTotalKbytes: "8000000"
    })
  };
})();
