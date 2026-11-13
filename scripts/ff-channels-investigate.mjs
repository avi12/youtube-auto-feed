await (async () => {
  const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
  const CHANNEL_ID = /"channelRenderer":\{"channelId":"(UC[\w-]{22})"/g;
  const HANDLE = /"canonicalBaseUrl":"\/(@[\w.-]+)"/g;
  const CONTINUATION = /"continuationCommand":\{"token":"([^"]+)"/;

  const res = await fetch("/feed/channels", { credentials: "include" });
  const raw = await res.text();
  const initialData = raw.match(INITIAL_DATA)?.[1] ?? "";

  const countIn = (text, re) => [...new Set([...text.matchAll(re)].map(m => m[1]))].length;

  // also try a GREEDY extraction to compare
  const GREEDY = /ytInitialData\s*=\s*(\{[\s\S]+\})\s*;\s*<\/script>/;
  const greedyData = raw.match(GREEDY)?.[1] ?? "";

  return {
    httpOk: res.ok,
    rawLength: raw.length,
    initialDataLength: initialData.length,
    greedyDataLength: greedyData.length,
    channelRenderersInRaw: countIn(raw, CHANNEL_ID),
    channelRenderersInInitialData: countIn(initialData, CHANNEL_ID),
    channelRenderersInGreedy: countIn(greedyData, CHANNEL_ID),
    handlesInRaw: countIn(raw, HANDLE),
    handlesInInitialData: countIn(initialData, HANDLE),
    continuationInInitialData: !!initialData.match(CONTINUATION),
    continuationInRaw: !!raw.match(CONTINUATION)
  };
})()
