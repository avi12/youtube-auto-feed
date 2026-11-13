await (async () => {
  const HEX_RADIX = 16;
  const MAX_TOKENS = 6;
  const TOKEN_HEAD_LENGTH = 24;
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
  function ucIn(text) {
    return new Set([...text.matchAll(/"channelId":"(UC[\w-]{22})"/g)].map(message => message[1]));
  }
  function browseUcIn(text) {
    return new Set([...text.matchAll(/"browseId":"(UC[\w-]{22})"/g)].map(messageValue => messageValue[1]));
  }

  const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
  const initialData =
    (await (await fetch("/feed/channels", { credentials: "include" })).text()).match(INITIAL_DATA)?.[1] ?? "";
  const initialUc = ucIn(initialData);

  // (1) every distinct continuation token -> how many NEW UC vs initial
  const tokens = [
    ...new Set(
      [...initialData.matchAll(/"continuationCommand":\{"token":"([^"]+)"/g)].map(
        messageValueValue => messageValueValue[1]
      )
    )
  ];
  const tokenResults = [];
  for (const token of tokens.slice(0, MAX_TOKENS)) {
    const cont = await innertubePost({
      endpoint: "browse",
      payload: {
        continuation: token
      }
    });
    const text = cont ? JSON.stringify(cont) : "";
    const contextValue = ucIn(text);
    const newUc = [...contextValue].filter(id => !initialUc.has(id)).length;
    tokenResults.push({
      tokenHead: token.slice(0, TOKEN_HEAD_LENGTH),
      totalUc: contextValue.size,
      newUc
    });
  }

  // (2) guide endpoint (sidebar subscriptions)
  const guide = await innertubePost({
    endpoint: "guide",
    payload: {}
  });
  const guideText = guide ? JSON.stringify(guide) : "";
  const guideBrowseUc = browseUcIn(guideText);
  const guideHandles = new Set(
    [...guideText.matchAll(/"\/(@[\w.-]+)"/g)].map(messageValueValueValue => messageValueValueValue[1].toLowerCase())
  );

  return {
    initialUcCount: initialUc.size,
    distinctTokenCount: tokens.length,
    tokenResults,
    guideOk: !!guide,
    guideDistinctBrowseUc: guideBrowseUc.size,
    guideDistinctHandles: guideHandles.size
  };
})();
