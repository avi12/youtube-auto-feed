await (async () => {
  const HEX_RADIX = 16;
  const MAX_PAGES = 8;
  const TOKEN_HEAD_LENGTH = 20;
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
  async function innertubePost(payload) {
    const key = ytcfg?.get("INNERTUBE_API_KEY");
    const char = ytcfg?.get("INNERTUBE_CONTEXT");
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

  // find tokens that sit inside a continuationItemRenderer (the real "load more" tokens)
  function findContinuationItemTokens({ node, acc }) {
    if (!node || typeof node !== "object") {
      return acc;
    }

    if (node.continuationItemRenderer) {
      const tok = node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (tok) {
        acc.push(tok);
      }
    }

    for (const keyValue of Object.keys(node)) {
      findContinuationItemTokens({
        node: node[keyValue],
        acc
      });
    }
    return acc;
  }
  function listItemTokens(node) {
    return findContinuationItemTokens({
      node,
      acc: []
    });
  }
  function ucIn(obj) {
    return new Set([...JSON.stringify(obj).matchAll(/"channelId":"(UC[\w-]{22})"/g)].map(message => message[1]));
  }

  const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
  const raw = await (await fetch("/feed/channels", { credentials: "include" })).text();
  let initial;
  try {
    initial = JSON.parse(raw.match(INITIAL_DATA)?.[1] ?? "{}");
  } catch (errorValue) {
    return { error: "parse fail: " + errorValue };
  }

  const all = new Set(ucIn(initial));
  const startCount = all.size;
  const itemTokens = listItemTokens(initial);
  const pages = [];
  let token = itemTokens[0];
  const seenTokens = new Set();
  for (let part = 0; token && !seenTokens.has(token) && part < MAX_PAGES; part++) {
    seenTokens.add(token);
    const resp = await innertubePost({ continuation: token });
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
    const nextTokens = listItemTokens(resp);
    pages.push({
      page: part,
      tokenHead: token.slice(0, TOKEN_HEAD_LENGTH),
      newUc: all.size - before,
      total: all.size,
      nextTokenHead: nextTokens[0]?.slice(0, TOKEN_HEAD_LENGTH) ?? null
    });
    token = nextTokens[0];
  }

  return {
    initialUc: startCount,
    continuationItemTokenCount: itemTokens.length,
    continuationItemTokenHeads: itemTokens.map(timeValue => timeValue.slice(0, TOKEN_HEAD_LENGTH)),
    finalTotalUc: all.size,
    pages
  };
})();
