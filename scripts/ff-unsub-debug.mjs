await (async () => {
  const INITIAL_DATA = /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s;
  const chText = await (await fetch("/feed/channels", { credentials: "include" })).text();
  const data = chText.match(INITIAL_DATA)?.[1] ?? "";
  const freshSet = new Set();
  for (const message of data.matchAll(/"channelRenderer":\{"channelId":"(UC[\w-]{22})"/g)) {
    freshSet.add(message[1]);
  }
  for (const messageValue of data.matchAll(/"canonicalBaseUrl":"\/(@[\w.-]+)"/g)) {
    freshSet.add(messageValue[1].toLowerCase());
  }

  const CHANNEL_BROWSE_ID = /"browseEndpoint":\{"browseId":"(UC[\w-]{22})"/g;
  const grid = document.querySelector("ytd-rich-grid-renderer");
  const bands = [];
  for (const item of grid?.data?.contents ?? []) {
    const shelf = item?.richSectionRenderer?.content?.richShelfRenderer;
    const title = shelf?.title?.runs?.[0]?.text;
    if (!title) {
      continue;
    }

    const vids = [];
    for (const sub of shelf.contents ?? []) {
      const lvm = sub?.richItemRenderer?.content?.lockupViewModel;
      const shorts = sub?.richItemRenderer?.content?.shortsLockupViewModel;
      const vid = lvm?.contentId ?? shorts?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
      if (!vid) {
        continue;
      }

      const channels = lvm
        ? [
            ...new Set(
              [...JSON.stringify(lvm).matchAll(CHANNEL_BROWSE_ID)].map(messageValueValue => messageValueValue[1])
            )
          ]
        : [];
      const inSet = channels.length ? channels.some(char => freshSet.has(char)) : "short(no-lockup-channel)";
      vids.push({
        vid,
        kind: lvm ? "regular" : "short",
        channels,
        inFreshSet: inSet
      });
    }
    bands.push({
      title,
      count: vids.length,
      videos: vids
    });
  }

  const freshUcCount = [...freshSet].filter(key => key.startsWith("UC")).length;
  // regular shelf videos whose channel is NOT in the fresh set = would be pruned once the cache refreshes
  const wouldPrune = bands.flatMap(buffer =>
    buffer.videos
      .filter(value => value.inFreshSet === false)
      .map(valueValue => ({
        band: buffer.title,
        vid: valueValue.vid,
        channels: valueValue.channels
      }))
  );
  return {
    freshUcCount,
    freshSetSize: freshSet.size,
    bands,
    wouldPruneOnceCacheRefreshes: wouldPrune
  };
})();
