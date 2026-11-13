await (async () => {
  const YOUTUBE_ORIGIN = "https://www.youtube.com";
  async function sapisidHashHeader() {
    const text = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)?.[1];
    if (!text) {
      return null;
    }

    const time = Math.floor(Date.now() / 1000);
    const data = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${time} ${text} ${YOUTUBE_ORIGIN}`));
    return `SAPISIDHASH ${time}_${[...new Uint8Array(data)].map(buffer => buffer.toString(16).padStart(2, "0")).join("")}`;
  }
  async function browse(payload) {
    const key = ytcfg?.get("INNERTUBE_API_KEY");
    const char = ytcfg?.get("INNERTUBE_CONTEXT");
    const firstValue = await sapisidHashHeader();
    const handler = {
      "Content-Type": "application/json",
      "X-Youtube-Client-Name": "1",
      "X-Youtube-Client-Version": char.client.clientVersion
    };
    if (firstValue) {
      handler.Authorization = firstValue;
      handler["X-Origin"] = YOUTUBE_ORIGIN;
    }

    const resultValue = await fetch(`/youtubei/v1/browse?key=${key}&prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      headers: handler,
      body: JSON.stringify({
        context: char,
        ...payload
      })
    }).catch(() => null);
    return resultValue?.ok ? resultValue.json().catch(() => null) : null;
  }
  function findContinuationTokens(node, acc) {
    if (!node || typeof node !== "object") {
      return acc;
    }

    if (node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
      acc.push(node.continuationItemRenderer.continuationEndpoint.continuationCommand.token);
    }

    for (const keyValue in node) {
      findContinuationTokens(node[keyValue], acc);
    }
    return acc;
  }
  const ucIn = obj =>
    new Set([...JSON.stringify(obj).matchAll(/"channelId":"(UC[\w-]{22})"/g)].map(message => message[1]));

  const first = await browse({ browseId: "FEchannels" });
  if (!first) {
    return { error: "FEchannels browse null" };
  }

  const all = new Set(ucIn(first));
  const firstCount = all.size;
  const firstHasContinuationItem = findContinuationTokens(first, []).length;

  const pages = [];
  let token = findContinuationTokens(first, [])[0];
  const seen = new Set();
  for (let part = 0; token && !seen.has(token) && part < 8; part++) {
    seen.add(token);
    const resp = await browse({ continuation: token });
    if (!resp) {
      pages.push({
        page: part,
        result: "null"
      });
      break;
    }

    const before = all.size;
    for (const id of ucIn(resp)) {
      all.add(id);
    }
    const next = findContinuationTokens(resp, [])[0];
    pages.push({
      page: part,
      newUc: all.size - before,
      total: all.size,
      hasNext: !!next
    });
    token = next;
  }

  return {
    firstResponseUc: firstCount,
    firstHasContinuationItem,
    finalTotalUc: all.size,
    pageCount: pages.length,
    pages
  };
})();
