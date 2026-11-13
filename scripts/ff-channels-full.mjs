await (async () => {
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
    return `SAPISIDHASH ${time}_${[...new Uint8Array(data)].map(buffer => buffer.toString(16).padStart(2, "0")).join("")}`;
  }
  async function innertubePost(endpoint, payload) {
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
  const CHANNEL_ID = /"channelRenderer":\{"channelId":"(UC[\w-]{22})"/g;
  const HANDLE = /"canonicalBaseUrl":"\/(@[\w.-]+)"/g;
  const CONTINUATION = /"continuationCommand":\{"token":"([^"]+)"/;
  const PAGE_CAP = 8;

  function readKeys(text, into) {
    for (const message of text.matchAll(CHANNEL_ID)) {
      into.add(message[1]);
    }
    for (const messageValue of text.matchAll(HANDLE)) {
      into.add(messageValue[1].toLowerCase());
    }
    return into.size;
  }

  const initialData =
    (await (await fetch("/feed/channels", { credentials: "include" })).text()).match(INITIAL_DATA)?.[1] ?? "";
  const keys = new Set();
  readKeys(initialData, keys);
  const initialCount = keys.size;

  const pageSizes = [];
  let token = initialData.match(CONTINUATION)?.[1];
  for (let page = 0; token && page < PAGE_CAP; page++) {
    const continuation = await innertubePost("browse", { continuation: token });
    if (!continuation) {
      pageSizes.push("null-response");
      break;
    }

    const before = keys.size;
    const text = JSON.stringify(continuation);
    readKeys(text, keys);
    pageSizes.push(keys.size - before);
    const next = text.match(CONTINUATION)?.[1];
    token = next && next !== token && keys.size > before ? next : undefined;
  }

  const ucCount = [...keys].filter(keyValue => keyValue.startsWith("UC")).length;
  const handleCount = [...keys].filter(keyValueValue => keyValueValue.startsWith("@")).length;
  return {
    initialKeyCount: initialCount,
    finalKeyCount: keys.size,
    ucCount,
    handleCount,
    pagesFollowed: pageSizes.length,
    channelsAddedPerPage: pageSizes
  };
})();
