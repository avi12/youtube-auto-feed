await (async () => {
  const fetchSource = globalThis.fetch.toString();
  const isFetchPatched = !fetchSource.includes("[native code]");
  const hasInterceptorMarker = typeof globalThis.__ytafFeedMessenger !== "undefined";

  // re-fetch /feed/channels now to see the current truth
  const raw = await (await fetch("/feed/channels", { credentials: "include" })).text();
  const initial = raw.match(/ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s)?.[1] ?? "";
  const ucNow = new Set([...initial.matchAll(/"channelRenderer":\{"channelId":"(UC[\w-]{22})"/g)].map(m => m[1]));

  return {
    isFetchPatched,
    hasInterceptorMarker,
    fetchSourceHead: fetchSource.slice(0, 120),
    feedChannelsUcCountNow: ucNow.size
  };
})()
