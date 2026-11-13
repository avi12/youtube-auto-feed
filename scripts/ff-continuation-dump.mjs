await (async () => {
  const HEX_RADIX = 16;
  const TOKEN_HEAD_SHORT = 30;
  const TOKEN_HEAD_LONG = 40;
  const SAMPLE_LENGTH = 260;
  const HEAD_LENGTH = 400;
  const YOUTUBE_ORIGIN = "https://www.youtube.com";
  async function sapisidHashHeader() {
    const textValue = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)?.[1];
    if (!textValue) {
      return null;
    }

    const time = Math.floor(Date.now() / 1000);
    const data = await crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(`${time} ${textValue} ${YOUTUBE_ORIGIN}`)
    );
    return `SAPISIDHASH ${time}_${[...new Uint8Array(data)].map(buffer => buffer.toString(HEX_RADIX).padStart(2, "0")).join("")}`;
  }
  async function innertubePost({ endpoint, payload }) {
    const key = ytcfg?.get("INNERTUBE_API_KEY");
    const char = ytcfg?.get("INNERTUBE_CONTEXT");
    if (!key || !char) {
      return null;
    }

    const first = await sapisidHashHeader();
    const handler = {
      "Content-Type": "application/json",
      "X-Youtube-Client-Name": "1",
      "X-Youtube-Client-Version": char.client.clientVersion
    };
    if (first) {
      handler.Authorization = first;
      handler["X-Origin"] = YOUTUBE_ORIGIN;
    }

    const result = await fetch(`/youtubei/v1/${endpoint}?key=${key}&prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      headers: handler,
      body: JSON.stringify({
        context: char,
        ...payload
      })
    }).catch(() => null);
    return result?.ok ? result.json().catch(() => null) : null;
  }

  const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
  const CONTINUATION = /"continuationCommand":\{"token":"([^"]+)"/;
  const initialData =
    (await (await fetch("/feed/channels", { credentials: "include" })).text()).match(INITIAL_DATA)?.[1] ?? "";
  const token = initialData.match(CONTINUATION)?.[1];
  if (!token) {
    return { error: "no token in initial" };
  }

  const cont = await innertubePost({
    endpoint: "browse",
    payload: {
      continuation: token
    }
  });
  if (!cont) {
    return {
      error: "null continuation response",
      tokenHead: token.slice(0, TOKEN_HEAD_SHORT)
    };
  }

  const text = JSON.stringify(cont);

  return {
    tokenHead: token.slice(0, TOKEN_HEAD_LONG),
    topLevelKeys: Object.keys(cont),
    responseLength: text.length,
    occChannelRenderer: (text.match(/"channelRenderer"/g) ?? []).length,
    occChannelIdUc: (text.match(/"channelId":"UC[\w-]{22}"/g) ?? []).length,
    occStrictRegex: (text.match(/"channelRenderer":\{"channelId":"UC[\w-]{22}"/g) ?? []).length,
    occCanonicalHandle: (text.match(/"canonicalBaseUrl":"\/@[\w.-]+"/g) ?? []).length,
    occContinuationItems: (text.match(/"continuationItems"/g) ?? []).length,
    occAppendAction: (text.match(/"appendContinuationItemsAction"/g) ?? []).length,
    sampleAroundChannelRenderer: text.includes('"channelRenderer"')
      ? text.slice(text.indexOf('"channelRenderer"'), text.indexOf('"channelRenderer"') + SAMPLE_LENGTH)
      : null,
    head: text.slice(0, HEAD_LENGTH)
  };
})();
