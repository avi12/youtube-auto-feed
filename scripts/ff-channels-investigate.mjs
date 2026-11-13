await (async () => {
  const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
  const CHANNEL_ID = /"channelRenderer":\{"channelId":"(UC[\w-]{22})"/g;
  const HANDLE = /"canonicalBaseUrl":"\/(@[\w.-]+)"/g;
  const CONTINUATION = /"continuationCommand":\{"token":"([^"]+)"/;

  const res = await fetch("/feed/channels", { credentials: "include" });
  const raw = await res.text();
  const initialData = raw.match(INITIAL_DATA)?.[1] ?? "";

  function countIn({ text, regex }) {
    return new Set([...text.matchAll(regex)].map(message => message[1])).size;
  }

  // also try a GREEDY extraction to compare
  const GREEDY = /ytInitialData\s*=\s*(\{[\s\S]+\})\s*;\s*<\/script>/;
  const greedyData = raw.match(GREEDY)?.[1] ?? "";

  return {
    httpOk: res.ok,
    rawLength: raw.length,
    initialDataLength: initialData.length,
    greedyDataLength: greedyData.length,
    channelRenderersInRaw: countIn({
      text: raw,
      regex: CHANNEL_ID
    }),
    channelRenderersInInitialData: countIn({
      text: initialData,
      regex: CHANNEL_ID
    }),
    channelRenderersInGreedy: countIn({
      text: greedyData,
      regex: CHANNEL_ID
    }),
    handlesInRaw: countIn({
      text: raw,
      regex: HANDLE
    }),
    handlesInInitialData: countIn({
      text: initialData,
      regex: HANDLE
    }),
    continuationInInitialData: !!initialData.match(CONTINUATION),
    continuationInRaw: !!raw.match(CONTINUATION)
  };
})();
